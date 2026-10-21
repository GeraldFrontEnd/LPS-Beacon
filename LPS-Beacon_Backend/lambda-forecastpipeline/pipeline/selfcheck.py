"""{"mode": "selfcheck"}: checks the deployment from inside Lambda, changes no data.

Checks
  python      pandas, numpy, openpyxl, scipy, scikit-learn import (the layers/image are right)
  matching    the matching adapter and matching_python_script.py load and have run_matching
  storage     write + read a small probe under clean/, curated/, results/ (write only under
              quarantine/), e.g. results/_selfcheck/probe.json, overwritten each time; list raw/
  encryption  bucket default encryption vs S3_SSE (needs s3:GetEncryptionConfiguration)
  trigger     an S3 event notification for this function on raw/ with ObjectCreated:*
              (needs s3:GetBucketNotification)
  alerts      ALERT_TOPIC_ARN is set
Each check reports ok true/false/null (null = could not check, e.g. missing permission).
"""
from __future__ import annotations

import importlib

from . import batch, matching
from .config import Config
from .s3io import Store, _client

PROBE_PREFIXES = ("clean/", "curated/", "results/", "quarantine/")


def _check(name: str, fn) -> dict:
    try:
        ok, detail = fn()
        return {"check": name, "ok": ok, "detail": detail}
    except Exception as exc:  # noqa: BLE001 - every failure is a finding, not a crash
        return {"check": name, "ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def _python():
    versions, missing = {}, []
    for module in ("pandas", "numpy", "openpyxl", "scipy", "sklearn"):
        try:
            versions[module] = importlib.import_module(module).__version__
        except ImportError:
            missing.append(module)
    detail = {"versions": versions}
    if missing:
        detail["missing"] = missing
        detail["fix"] = "deploy as the container image in DEPLOY.md (scipy + scikit-learn do not fit in layers)"
    return not missing, detail


def _matching(cfg: Config):
    module = matching._load_module(cfg.matching_script)
    entry = next((n for n in matching.ENTRY_POINTS if callable(getattr(module, n, None))), None)
    return entry is not None, {"script": cfg.matching_script, "entryPoint": entry}


def _storage(store: Store):
    results = {}
    for prefix in PROBE_PREFIXES:
        key = f"{prefix}_selfcheck/probe.json"
        store.write_json(key, {"probe": batch.now_iso()})
        if prefix == "quarantine/":               # write-only by design: nothing reads it back
            results[prefix] = "write ok"
            continue
        store.read_json(key)
        results[prefix] = "write+read ok"
    store.list_keys("raw/")
    results["raw/"] = "list ok"
    return True, results


def _encryption(cfg: Config):
    if cfg.local_data_dir:
        return None, "local folder"
    rules = _client(cfg.bucket_region).get_bucket_encryption(Bucket=cfg.data_bucket)[
        "ServerSideEncryptionConfiguration"]["Rules"]
    default = rules[0]["ApplyServerSideEncryptionByDefault"]
    algorithm = default["SSEAlgorithm"]
    detail = {"bucketDefault": algorithm, "kmsKey": default.get("KMSMasterKeyID"),
              "S3_SSE": cfg.s3_sse or "(empty: bucket default is used)"}
    if algorithm.startswith("aws:kms"):
        detail["note"] = ("bucket uses KMS: the role needs kms:Decrypt and kms:GenerateDataKey on that key, "
                          "and the API Lambda needs kms:Decrypt to read results/")
    mismatch = cfg.s3_sse and cfg.s3_sse != algorithm and not (
        cfg.s3_sse == "aws:kms" and algorithm.startswith("aws:kms"))
    if mismatch:
        detail["warning"] = "S3_SSE differs from the bucket default; a bucket policy may reject the writes"
    return not mismatch, detail


def _trigger(cfg: Config, function_arn: str | None):
    if cfg.local_data_dir:
        return None, "local folder"
    conf = _client(cfg.bucket_region).get_bucket_notification_configuration(Bucket=cfg.data_bucket)
    found = []
    for item in conf.get("LambdaFunctionConfigurations", []):
        rules = item.get("Filter", {}).get("Key", {}).get("FilterRules", [])
        prefix = next((r["Value"] for r in rules if r["Name"].lower() == "prefix"), "")
        found.append({"function": item["LambdaFunctionArn"], "events": item["Events"], "prefix": prefix})
    mine = [f for f in found if not function_arn or f["function"].split(":")[:7] == function_arn.split(":")[:7]]
    def covers_multipart(events):
        return "s3:ObjectCreated:*" in events or {"s3:ObjectCreated:Put",
                                                   "s3:ObjectCreated:CompleteMultipartUpload"} <= set(events)

    good = [f for f in mine if f["prefix"].startswith("raw") and covers_multipart(f["events"])]
    detail = {"notifications": found}
    if not mine:
        detail["fix"] = "add the raw/ event notification (DEPLOY.md step 9)"
    elif not good:
        detail["fix"] = ("use event type 'All object create events' (s3:ObjectCreated:*) so multipart "
                         "uploads (CompleteMultipartUpload) also start the pipeline")
    loops = [f for f in mine if not f["prefix"].startswith("raw")]
    if loops:
        detail["danger"] = "a notification outside raw/ would make the function trigger itself in a loop"
    return bool(good) and not loops, detail


def run(cfg: Config, store: Store, context=None) -> dict:
    function_arn = getattr(context, "invoked_function_arn", None)
    checks = [
        _check("python", _python),
        _check("matching", lambda: _matching(cfg)),
        _check("storage", lambda: _storage(store)),
        _check("encryption", lambda: _encryption(cfg)),
        _check("trigger", lambda: _trigger(cfg, function_arn)),
        _check("alerts", lambda: (bool(cfg.alert_topic_arn) or None,
                                  cfg.alert_topic_arn or "ALERT_TOPIC_ARN not set: no emails")),
    ]
    return {"mode": "selfcheck", "allOk": all(c["ok"] is not False for c in checks), "checks": checks,
            "settings": {"autoRunOnUpload": cfg.auto_run_on_upload,
                         "uploadSettleSeconds": cfg.upload_settle_seconds, "s3Sse": cfg.s3_sse or "(bucket default)"}}
