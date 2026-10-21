"""Settings for lambda-forecastpipeline.

Every tunable value comes from an environment variable so you can change it in
the Lambda console (Configuration > Environment variables) without a redeploy.
An event may override the planning date with {"asOf": "2026-09-01"}.
"""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass


class ConfigError(ValueError):
    """Raised at start-up when a setting is missing or wrong."""


SSE_MODES = ("", "AES256", "aws:kms")


@dataclass(frozen=True)
class Config:
    data_bucket: str            # S3 bucket name (not the ARN), e.g. lps-beacon-data
    bucket_region: str          # e.g. ap-southeast-1
    local_data_dir: str         # if set, a local folder is used instead of S3 (testing)
    alert_topic_arn: str        # SNS topic for success/failure emails ("" = no email)
    as_of: dt.date              # planning date, always the 1st of a month
    as_of_explicit: bool        # True when asOf came from the event or AS_OF_DATE
    window_months: int          # rolling matching/forecast window
    grade_tolerance: int        # +/- grades allowed in tiers T3/T4
    max_idle_months: int        # longest gap allowed between availability and start
    skill_threshold: float      # min skill similarity when both sides list skills
    renewal_rate: float         # share of FY-end roll-offs expected to renew
    rp_full_month_mds: float    # man-days that count as 1 FTE in the resource plan
    ql_full_month_mds: float    # man-days that count as 1 FTE in quote lines
    max_upload_mb: int          # files above this are quarantined
    allow_macro_files: bool     # .xlsm containing macros: quarantine unless true
    matching_script: str        # path of the matching adapter inside the package
    auto_run_on_upload: bool    # run match -> forecast -> publish after an upload batch
    upload_settle_seconds: int  # wait for the rest of a batch to land before running
    s3_sse: str                 # "" = bucket default, "AES256" or "aws:kms"
    s3_kms_key_id: str          # KMS key id/ARN when s3_sse is aws:kms ("" = AWS managed key)
    review_on_upload: bool      # after an upload, pause for the user's review (conflicts, opportunity
                                # forecast, matching) instead of running straight through
    forecast_stages: tuple      # SFDC stages whose opportunities get a resource forecast, e.g. ("O1", "O2")
    similarity_threshold: float # 0-1; how alike an ABCD project must be to be offered as a "similar project"


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError as exc:
        raise ConfigError(f"{name} must be a whole number, got {raw!r}") from exc


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("true", "1", "yes"):
        return True
    if raw in ("false", "0", "no"):
        return False
    raise ConfigError(f"{name} must be true or false, got {raw!r}")


def parse_as_of(raw: str) -> dt.date:
    try:
        return dt.date.fromisoformat(str(raw).strip()[:10]).replace(day=1)
    except ValueError as exc:
        raise ConfigError(f"AS_OF_DATE / asOf must look like 2026-09-01, got {raw!r}") from exc


def _as_of(override: str | None) -> tuple[dt.date, bool]:
    raw = (override or os.environ.get("AS_OF_DATE", "")).strip()
    if not raw:
        return dt.date.today().replace(day=1), False
    return parse_as_of(raw), True


def load(event: dict | None = None) -> Config:
    event = event or {}
    local_dir = os.environ.get("LOCAL_DATA_DIR", "").strip()
    bucket = os.environ.get("DATA_BUCKET", "").strip()
    region = os.environ.get("BUCKET_REGION", "").strip()

    if not local_dir:
        if not bucket:
            raise ConfigError("DATA_BUCKET is not set (use the bucket name, e.g. lps-beacon-data)")
        if bucket.startswith("arn:") or "/" in bucket:
            raise ConfigError("DATA_BUCKET must be the bucket name, not an ARN or a path")
        if not region:
            raise ConfigError("BUCKET_REGION is not set (e.g. ap-southeast-1)")

    sse = os.environ.get("S3_SSE", "").strip()
    if sse.lower() == "aes256":
        sse = "AES256"
    if sse not in SSE_MODES:
        raise ConfigError(f"S3_SSE must be empty, AES256 or aws:kms, got {sse!r}")
    kms_key = os.environ.get("S3_KMS_KEY_ID", "").strip()
    if kms_key and sse != "aws:kms":
        raise ConfigError("S3_KMS_KEY_ID is set but S3_SSE is not aws:kms")

    as_of, explicit = _as_of(event.get("asOf"))
    cfg = Config(
        data_bucket=bucket,
        bucket_region=region,
        local_data_dir=local_dir,
        alert_topic_arn=os.environ.get("ALERT_TOPIC_ARN", "").strip(),
        as_of=as_of,
        as_of_explicit=explicit,
        window_months=_int("WINDOW_MONTHS", 12),
        grade_tolerance=_int("GRADE_TOLERANCE", 1),
        max_idle_months=_int("MAX_IDLE_MONTHS", 6),
        skill_threshold=_float("SKILL_THRESHOLD", 0.15),
        renewal_rate=_float("RENEWAL_RATE", 0.8),
        rp_full_month_mds=_float("RP_FULL_MONTH_MDS", 18.0),
        ql_full_month_mds=_float("QL_FULL_MONTH_MDS", 18.5),
        max_upload_mb=_int("MAX_UPLOAD_MB", 20),
        allow_macro_files=_bool("ALLOW_MACRO_FILES", False),
        matching_script=os.environ.get("MATCHING_SCRIPT", "matching_script.py").strip(),
        auto_run_on_upload=_bool("AUTO_RUN_ON_UPLOAD", True),
        upload_settle_seconds=_int("UPLOAD_SETTLE_SECONDS", 15),
        s3_sse=sse,
        s3_kms_key_id=kms_key,
        review_on_upload=_bool("REVIEW_ON_UPLOAD", True),
        forecast_stages=tuple(s.strip() for s in os.environ.get("FORECAST_STAGES", "O1,O2,O3,O4,O5").split(",")
                              if s.strip()),
        similarity_threshold=_float("SIMILARITY_THRESHOLD", 0.6),
    )
    if not 0 <= cfg.renewal_rate <= 1:
        raise ConfigError("RENEWAL_RATE must be between 0 and 1")
    if cfg.window_months < 1:
        raise ConfigError("WINDOW_MONTHS must be at least 1")
    if not 0 <= cfg.similarity_threshold <= 1:
        raise ConfigError("SIMILARITY_THRESHOLD must be between 0 and 1")
    if not 0 <= cfg.upload_settle_seconds <= 120:
        raise ConfigError("UPLOAD_SETTLE_SECONDS must be between 0 and 120")
    return cfg
