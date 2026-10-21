"""Storage for the pipeline: S3 in Lambda, a local folder when testing.

Tables between stages are stored as gzipped pandas "table" JSON. It keeps the
column types (dates, integers) and needs no extra library such as pyarrow, so
the same code runs in Lambda and on a Windows laptop.
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import os
from pathlib import Path

import pandas as pd

from .config import Config

_s3_client = None  # created once per Lambda container, reused across invocations


def _client(region: str):
    global _s3_client
    if _s3_client is None:
        import boto3  # imported here so local tests run without boto3 installed
        _s3_client = boto3.client("s3", region_name=region)
    return _s3_client


class Store:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.local = Path(cfg.local_data_dir) if cfg.local_data_dir else None

    # ---------- bytes ----------
    def read_bytes(self, key: str) -> bytes:
        if self.local:
            return (self.local / key).read_bytes()
        obj = _client(self.cfg.bucket_region).get_object(Bucket=self.cfg.data_bucket, Key=key)
        return obj["Body"].read()

    def write_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        if self.local:
            path = self.local / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return
        extra = {}
        # Empty S3_SSE = no header, so the bucket's default encryption (SSE-S3 or SSE-KMS)
        # applies. Forcing AES256 would be rejected by a bucket policy that requires KMS.
        if self.cfg.s3_sse:
            extra["ServerSideEncryption"] = self.cfg.s3_sse
            if self.cfg.s3_sse == "aws:kms" and self.cfg.s3_kms_key_id:
                extra["SSEKMSKeyId"] = self.cfg.s3_kms_key_id
        _client(self.cfg.bucket_region).put_object(
            Bucket=self.cfg.data_bucket, Key=key, Body=data, ContentType=content_type, **extra)

    def size(self, key: str) -> int:
        if self.local:
            return (self.local / key).stat().st_size
        head = _client(self.cfg.bucket_region).head_object(Bucket=self.cfg.data_bucket, Key=key)
        return int(head["ContentLength"])

    def exists(self, key: str) -> bool:
        if self.local:
            return (self.local / key).exists()
        # A listing (not head_object) so a missing key is "False", not "403 Forbidden",
        # with a ListBucket permission limited to prefixes.
        response = _client(self.cfg.bucket_region).list_objects_v2(
            Bucket=self.cfg.data_bucket, Prefix=key, MaxKeys=1)
        return any(item["Key"] == key for item in response.get("Contents", []))

    def list_keys(self, prefix: str) -> list[str]:
        if self.local:
            base = self.local / prefix
            if not base.exists():
                return []
            return sorted(str(p.relative_to(self.local)).replace(os.sep, "/")
                          for p in base.rglob("*") if p.is_file())
        keys: list[str] = []
        paginator = _client(self.cfg.bucket_region).get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.cfg.data_bucket, Prefix=prefix):
            keys.extend(item["Key"] for item in page.get("Contents", []))
        return sorted(keys)

    def list_objects(self, prefix: str) -> list[tuple[str, dt.datetime]]:
        """(key, last modified in UTC) for every object under prefix."""
        if self.local:
            base = self.local / prefix
            if not base.exists():
                return []
            return sorted((str(p.relative_to(self.local)).replace(os.sep, "/"),
                           dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc))
                          for p in base.rglob("*") if p.is_file())
        out: list[tuple[str, dt.datetime]] = []
        paginator = _client(self.cfg.bucket_region).get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.cfg.data_bucket, Prefix=prefix):
            out.extend((item["Key"], item["LastModified"]) for item in page.get("Contents", []))
        return sorted(out)

    def read_json_or(self, key: str, default):
        """read_json, or default when the key does not exist yet."""
        return self.read_json(key) if self.exists(key) else default

    # ---------- JSON ----------
    def write_json(self, key: str, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str, indent=1).encode("utf-8")
        self.write_bytes(key, body, "application/json")

    def read_json(self, key: str):
        return json.loads(self.read_bytes(key).decode("utf-8"))

    # ---------- tables ----------
    def write_table(self, key: str, df: pd.DataFrame) -> None:
        text = df.reset_index(drop=True).to_json(orient="table", date_format="iso", index=False)
        self.write_bytes(key, gzip.compress(text.encode("utf-8")), "application/gzip")

    def read_table(self, key: str) -> pd.DataFrame:
        text = gzip.decompress(self.read_bytes(key)).decode("utf-8")
        df = pd.read_json(io.StringIO(text), orient="table")
        return df.reset_index(drop=True)

    def write_tables(self, prefix: str, tables: dict[str, pd.DataFrame]) -> None:
        for name, df in tables.items():
            self.write_table(f"{prefix}{name}.json.gz", df)

    def read_tables(self, prefix: str) -> dict[str, pd.DataFrame]:
        out: dict[str, pd.DataFrame] = {}
        for key in self.list_keys(prefix):
            if key.endswith(".json.gz"):
                name = key[len(prefix):-len(".json.gz")]
                if "/" not in name:
                    out[name] = self.read_table(key)
        return out
