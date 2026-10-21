"""Upload batches: which uploads belong together, and the status file the upload page polls.

An end-user uploads several files at once (resource plan, quote line, mapping, rates).
Each file lands in raw/ and starts its own Lambda invocation (S3 event). The full run
(match -> forecast -> publish) must start once, after the LAST file of that upload is
cleaned, not once per file and not before the other files arrive.

Batch = the folder the files were uploaded into. Recommended key layout for the upload page:

    raw/<user>/<yyyy-mm-dd>/<batchId>/<original file name>

All files with the same <batchId> folder are one batch. Keys in the older layout
raw/<user>/<date>/<id>-<n>.<ext> still work: the batch is then raw/<user>/<date>/.

Optional manifest: the upload page may PUT raw/<...>/<batchId>/_batch.json containing
{"expectedFiles": 3}. The run then waits until that many files are processed. Without it
the pipeline waits until no file in the folder is unprocessed and the newest one is at
least UPLOAD_SETTLE_SECONDS old.

Status file (read by the API Lambda, which already has GetObject on results/*):

    results/uploads/<batchId path>/status.json
    {
      "batchId": "alice/2026-10-21/7f3a",
      "files": [{"key", "name", "status": "cleaned" | "quarantined", "dataset",
                 "warnings", "reason", "at"}],
      "expectedFiles": 3 | null,
      "run": {"state": ..., "message", "runId", "resultsPrefix", "at"},
      "updatedAt": "..."
    }

run.state values:
    waiting_for_files   other files of this upload are not processed yet
    waiting_for_inputs  no resource plan or quote line has ever been cleaned
    not_run             every file of this upload was rejected (see files[].reason)
    disabled            AUTO_RUN_ON_UPLOAD is false; use "Run forecast"
    running             match -> forecast -> publish in progress
    published           done; results are at resultsPrefix (and results/latest.json)
    failed              the run failed; message has the error; "Run forecast" retries it
"""
from __future__ import annotations

import datetime as dt
import json
import time

from .s3io import Store

MANIFEST_NAME = "_batch.json"
FINAL_FILE_STATES = ("cleaned", "quarantined")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def file_name(key: str) -> str:
    return key.rsplit("/", 1)[-1]


def is_control_file(key: str) -> bool:
    """Manifest or hidden files: not data, never validated or quarantined."""
    return file_name(key).startswith(("_", "."))


def batch_prefix(key: str) -> str:
    """raw/<user>/<date>/<batch>/<file> -> raw/<user>/<date>/<batch>/; else the parent folder."""
    return key.rsplit("/", 1)[0] + "/"


def batch_id(prefix: str) -> str:
    return prefix[len("raw/"):].strip("/") if prefix.startswith("raw/") else prefix.strip("/")


def uploader(prefix: str) -> str:
    parts = prefix.split("/")
    return parts[1] if len(parts) > 2 and parts[0] == "raw" else "unknown"


def status_key(batch: str) -> str:
    return f"results/uploads/{batch}/status.json"


# ---------------------------------------------------------------- status file
def load_status(store: Store, batch: str, prefix: str) -> dict:
    return store.read_json_or(status_key(batch), {
        "batchId": batch, "prefix": prefix, "uploadedBy": uploader(prefix),
        "createdAt": now_iso(), "files": [], "expectedFiles": None,
        "run": {"state": "waiting_for_files", "message": "processing uploads"},
    })


def save_status(store: Store, status: dict) -> None:
    status["updatedAt"] = now_iso()
    store.write_json(status_key(status["batchId"]), status)


def record_file(store: Store, key: str, result: dict) -> dict:
    """Adds or replaces one file's outcome in its batch status. Returns the status."""
    prefix = batch_prefix(key)
    status = load_status(store, batch_id(prefix), prefix)
    entry = {"key": key, "name": file_name(key), "at": now_iso(),
             **{k: result.get(k) for k in ("status", "dataset", "warnings", "reason")}}
    status["files"] = [f for f in status["files"] if f["key"] != key] + [entry]
    save_status(store, status)
    return status


def set_run(store: Store, status: dict, state: str, message: str = "", **extra) -> dict:
    status["run"] = {"state": state, "message": message, "at": now_iso(), **extra}
    save_status(store, status)
    return status


# ---------------------------------------------------------------- readiness
def expected_files(store: Store, prefix: str) -> int | None:
    key = prefix + MANIFEST_NAME
    if not store.exists(key):
        return None
    try:
        value = json.loads(store.read_bytes(key).decode("utf-8")).get("expectedFiles")
        return int(value) if value else None
    except (ValueError, AttributeError, TypeError):
        return None


def wait_until_quiet(store: Store, prefix: str, settle_seconds: int,
                     remaining_ms=lambda: 10 ** 9) -> list[tuple[str, dt.datetime]]:
    """Waits until the newest object in the batch folder is settle_seconds old.

    Pre-signed PUTs from one upload land within seconds of each other, but each S3
    event starts its own invocation, so the first invocation may run before the other
    files exist. Waiting for the folder to go quiet avoids a run on half an upload.
    Never waits longer than settle_seconds in total, nor into the last 60 s of the
    Lambda timeout.
    """
    waited = 0.0
    while True:
        objects = [(k, m) for k, m in store.list_objects(prefix) if "/" not in k[len(prefix):]]
        if not objects or settle_seconds <= 0:
            return objects
        newest = max(m for _, m in objects)
        age = (dt.datetime.now(dt.timezone.utc) - newest).total_seconds()
        budget = min(settle_seconds - waited, (remaining_ms() - 60_000) / 1000)
        if age >= settle_seconds or budget <= 0:
            return objects
        pause = min(settle_seconds - age, budget)
        time.sleep(max(pause, 0.05))
        waited += pause


def pending(objects: list[tuple[str, dt.datetime]], status: dict) -> list[str]:
    """Data files in the folder that this batch has not finished processing."""
    done = {f["key"] for f in status["files"] if f.get("status") in FINAL_FILE_STATES}
    return [k for k, _ in objects if not is_control_file(k) and k not in done]
