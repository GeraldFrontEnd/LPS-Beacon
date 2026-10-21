"""lambda-forecastpipeline: one Lambda, several stages.

Handler: lambda_function.lambda_handler

How it is started, and what runs
  S3 upload under raw/ (S3 event notification)
      -> FILE mode: validate -> clean that file, then, when it is the last file of its
         upload batch, match -> forecast -> publish (AUTO_RUN_ON_UPLOAD, default true).
         The upload page polls results/uploads/<batchId>/status.json (see pipeline/batch.py).
  On demand ("Run forecast" button via the API Lambda, or a console test)
      {"mode": "full"}                                 match -> forecast -> publish
      {"mode": "full", "stages": ["forecast", "publish"]}   only those stages; skipped
          stages are read from curated/<stage>/latest/ and their planning date is reused
      {"mode": "full", "batchId": "..."}               also updates that upload's status file
      {"mode": "file", "keys": ["raw/..."], "autoRun": true}   re-clean files (and run)
  Schedule (EventBridge, monthly or quarterly)       {"mode": "full", "requestedBy": "schedule"}
  Deployment check                                   {"mode": "selfcheck"}

Optional event fields: "asOf": "2026-09-01" (planning date), "requestedBy": "email".
Reserved concurrency 1 makes invocations run one at a time, so uploads, scheduled and
on-demand runs never write results/ at the same time.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import time
from urllib.parse import unquote_plus

from pipeline import batch, clean, config, forecast, matching, publish, selfcheck, validate
from pipeline.s3io import Store

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger("forecastpipeline")

FULL_STAGES = ["match", "forecast", "publish"]


def _log(event: str, **fields) -> None:
    log.info(json.dumps({"event": event, **fields}, default=str))


def _remaining(context):
    return context.get_remaining_time_in_millis if context else (lambda: 10 ** 9)


# ---------------------------------------------------------------- FILE mode
def _file_keys(event: dict) -> list[str]:
    if "Records" in event:
        # S3 sends keys URL-encoded: spaces arrive as '+', so decode them.
        return [unquote_plus(r["s3"]["object"]["key"]) for r in event["Records"]
                if r.get("eventSource") == "aws:s3" and r.get("eventName", "ObjectCreated").startswith(
                    ("ObjectCreated", "s3:ObjectCreated"))]
    return list(event.get("keys") or [event["key"]])


def clean_one(cfg, store: Store, key: str) -> dict:
    """validate -> clean one raw file; quarantine it on rejection. Never raises for bad files."""
    try:
        data = validate.run(cfg, store, key)
        quality = clean.run_file(cfg, store, key, data, validate.extension(key))
        _log("cleaned", key=key, dataset=quality["dataset"], warnings=quality["warnings"])
        return {"key": key, "status": "cleaned", "dataset": quality["dataset"],
                "warnings": quality["warnings"]}
    except (validate.Rejected, clean.CleanError) as exc:
        target = validate.quarantine(store, key, str(exc))
        _log("quarantined", key=key, reason=str(exc), target=target)
        publish.notify(cfg, "LPS-Beacon: upload rejected", {"key": key, "reason": str(exc)})
        return {"key": key, "status": "quarantined", "reason": str(exc)}


def run_file_mode(cfg, store: Store, event: dict, context=None) -> dict:
    results, batches = [], {}
    for key in _file_keys(event):
        if not key.startswith("raw/"):
            _log("skipped", key=key, reason="not under raw/")
            continue
        prefix = batch.batch_prefix(key)
        batches[batch.batch_id(prefix)] = prefix
        if batch.is_control_file(key):          # e.g. _batch.json: only (re)checks readiness
            _log("control_file", key=key)
            continue
        result = clean_one(cfg, store, key)
        batch.record_file(store, key, result)
        results.append(result)

    auto = event.get("autoRun", cfg.auto_run_on_upload)
    runs = [maybe_run_batch(cfg, store, b, p, auto, context) for b, p in batches.items()]
    return {"mode": "file", "files": results, "batches": runs}


def maybe_run_batch(cfg, store: Store, batch_id: str, prefix: str, auto: bool, context=None) -> dict:
    """Starts match -> forecast -> publish once every file of the upload batch is processed."""
    status = batch.load_status(store, batch_id, prefix)
    if not auto:
        batch.set_run(store, status, "disabled", "automatic run is off; use Run forecast")
        return {"batchId": batch_id, "state": "disabled"}

    objects = batch.wait_until_quiet(store, prefix, cfg.upload_settle_seconds, _remaining(context))
    status = batch.load_status(store, batch_id, prefix)        # other files may have finished meanwhile
    waiting = batch.pending(objects, status)
    expected = batch.expected_files(store, prefix)
    status["expectedFiles"] = expected
    processed = [f for f in status["files"] if f.get("status") in batch.FINAL_FILE_STATES]
    if waiting:
        names = ", ".join(batch.file_name(k) for k in waiting)
        batch.set_run(store, status, "waiting_for_files", f"still processing: {names}")
        return {"batchId": batch_id, "state": "waiting_for_files", "pending": waiting}
    if expected and len(processed) < expected:
        batch.set_run(store, status, "waiting_for_files",
                      f"{len(processed)} of {expected} files received")
        return {"batchId": batch_id, "state": "waiting_for_files"}
    if not any(f.get("status") == "cleaned" for f in processed):
        batch.set_run(store, status, "not_run", "every file in this upload was rejected; see the reasons")
        return {"batchId": batch_id, "state": "not_run"}
    missing = [name for name, key in (("resource plan", "clean/resource_plan/latest_wide.json.gz"),
                                      ("quote line", "clean/quoteline/latest_wide.json.gz"))
               if not store.exists(key)]
    if missing:
        batch.set_run(store, status, "waiting_for_inputs",
                      f"upload a {' and a '.join(missing)} to run the forecast")
        return {"batchId": batch_id, "state": "waiting_for_inputs"}

    try:
        result = run_full_mode(cfg, store, {"mode": "full", "trigger": "upload", "batchId": batch_id,
                                            "requestedBy": status.get("uploadedBy")})
    except Exception as exc:  # noqa: BLE001 - the cleaned files stay; "Run forecast" retries
        # Not re-raised: an S3-event retry would re-clean every file for nothing.
        log.exception("upload-triggered run failed")
        publish.notify(cfg, "LPS-Beacon pipeline FAILED", {"batchId": batch_id, "error": str(exc)})
        latest = batch.load_status(store, batch_id, prefix)
        if latest["run"].get("state") != "failed":           # run_full_mode usually set it already
            batch.set_run(store, latest, "failed", str(exc))
        return {"batchId": batch_id, "state": "failed", "error": str(exc)}
    return {"batchId": batch_id, "state": "published", "runId": result["runId"]}


# ---------------------------------------------------------------- FULL mode
def _stages(event: dict) -> list[str]:
    stages = event.get("stages") or FULL_STAGES
    unknown = [s for s in stages if s not in FULL_STAGES]
    if unknown:
        raise ValueError(f"unknown stage(s) {unknown}; choose from {FULL_STAGES}")
    stages = [s for s in FULL_STAGES if s in stages]             # always in pipeline order
    first = FULL_STAGES.index(stages[0])
    if stages != FULL_STAGES[first:first + len(stages)]:
        # e.g. ["match", "publish"] would publish a forecast built on a different matching run
        raise ValueError(f"stages {stages} skip a step in between; choose consecutive stages of {FULL_STAGES}")
    return stages


def _planning_date(cfg, store: Store, stages: list[str], warnings: list[str]):
    """When matching (or forecast) is reused, reuse its planning date too.

    Without this a forecast-only run used the current month while the matching it
    reused was done for another month, mixing two planning dates in one result.
    """
    if "match" in stages:
        return cfg
    source = "matching" if "forecast" in stages else "forecast"
    saved = store.read_json_or(f"curated/{source}/latest/run.json", {}).get("asOf")
    if not saved:
        warnings.append(f"the saved {source} output has no planning date recorded; using {cfg.as_of}")
        return cfg
    saved_date = config.parse_as_of(saved)
    if cfg.as_of_explicit and saved_date != cfg.as_of:
        raise ValueError(f"asOf {cfg.as_of} differs from the saved {source} run ({saved_date}); "
                         f"include \"match\" in stages to rerun it for {cfg.as_of}")
    return dataclasses.replace(cfg, as_of=saved_date)


def run_full_mode(cfg, store: Store, event: dict) -> dict:
    stages = _stages(event)
    warnings: list[str] = []
    cfg = _planning_date(cfg, store, stages, warnings)
    batch_id = event.get("batchId")
    status = None
    if batch_id:
        status = batch.load_status(store, batch_id, f"raw/{batch_id}/")
        batch.set_run(store, status, "running", "matching, forecast and publish in progress")

    run_id = publish.new_run_id()
    timings: dict[str, float] = {}
    trigger = event.get("trigger") or ("schedule" if event.get("requestedBy") == "schedule" else "on_demand")
    _log("run_started", runId=run_id, stages=stages, asOf=cfg.as_of, trigger=trigger, batchId=batch_id)

    def timed(name, fn):
        start = time.perf_counter()
        value = fn()
        timings[name] = round(time.perf_counter() - start, 2)
        _log("stage_done", runId=run_id, stage=name, seconds=timings[name])
        return value

    try:
        inputs = timed("load", lambda: clean.load_latest(store))
        for dataset in ("resource_plan", "quoteline"):
            warnings += [f"{dataset}: {w}" for w in inputs[dataset]["quality"].get("warnings", [])]

        # ---- match
        if "match" in stages:
            match_tables, match_warnings = timed("match", lambda: matching.run(cfg, inputs, store))
            warnings += match_warnings
            _save_stage(store, "matching", run_id, match_tables)
            _save_json(store, "matching", run_id, "run", {"runId": run_id, "asOf": cfg.as_of.isoformat()})
            matching_run = run_id
        else:
            match_tables = _load_stage(store, "matching")
            matching_run = store.read_json_or("curated/matching/latest/run.json", {}).get("runId")

        # ---- forecast
        if "forecast" in stages:
            fc_tables, fin_tables, kpis, fc_warnings = timed(
                "forecast", lambda: forecast.run(cfg, inputs, match_tables))
            warnings += fc_warnings
            _save_stage(store, "forecast", run_id, fc_tables)
            _save_stage(store, "finance", run_id, fin_tables)
            _save_json(store, "forecast", run_id, "kpis", kpis)
            _save_json(store, "forecast", run_id, "run", {"runId": run_id, "asOf": cfg.as_of.isoformat(),
                                                          "matchingRunId": matching_run})
            forecast_run = run_id
        else:
            fc_tables = _load_stage(store, "forecast")
            kpis = store.read_json("curated/forecast/latest/kpis.json")
            # Finance belongs to the same forecast run (latest/ may hold an older finance set).
            forecast_run = store.read_json("curated/forecast/latest/run.json")["runId"]
            fin_tables = store.read_tables(f"curated/finance/{forecast_run}/")

        # ---- publish
        manifest = {
            "stages": stages, "trigger": trigger, "batchId": batch_id, "asOf": cfg.as_of.isoformat(),
            "requestedBy": event.get("requestedBy"), "matchingRunId": matching_run,
            "forecastRunId": forecast_run,
            "parameters": {"windowMonths": cfg.window_months, "gradeTolerance": cfg.grade_tolerance,
                           "maxIdleMonths": cfg.max_idle_months, "skillThreshold": cfg.skill_threshold,
                           "renewalRate": cfg.renewal_rate, "rpFullMonthMds": cfg.rp_full_month_mds,
                           "qlFullMonthMds": cfg.ql_full_month_mds},
            "inputs": {d: inputs[d]["quality"].get("sourceKey")
                       for d in ("resource_plan", "quoteline", "position_mapping") if d in inputs},
            "dataGaps": kpis.get("dataGaps", {}),
            "rowCounts": {n: len(df) for n, df in {**fc_tables, **fin_tables}.items()},
            "warnings": warnings, "timings": timings,
        }
        if "publish" in stages:
            manifest = timed("publish", lambda: publish.run(
                cfg, store, run_id, fc_tables, fin_tables, match_tables, kpis, manifest))
    except Exception as exc:
        if status is not None:
            batch.set_run(store, batch.load_status(store, batch_id, f"raw/{batch_id}/"), "failed", str(exc),
                          runId=run_id)
        raise

    if status is not None:
        status = batch.load_status(store, batch_id, f"raw/{batch_id}/")
        state = "published" if "publish" in stages else "computed"
        batch.set_run(store, status, state, f"{len(warnings)} warning(s)", runId=run_id,
                      resultsPrefix=f"results/{run_id}/" if "publish" in stages else None,
                      warnings=warnings, kpis=kpis)
    publish.notify(cfg, f"LPS-Beacon forecast {run_id} finished",
                   {"runId": run_id, "trigger": trigger, "batchId": batch_id, "stages": stages,
                    "kpis": kpis, "warnings": warnings})
    _log("run_finished", runId=run_id, warnings=len(warnings), timings=timings)
    return {"mode": "full", "runId": run_id, "stages": stages, "asOf": cfg.as_of.isoformat(),
            "trigger": trigger, "batchId": batch_id, "warnings": warnings, "timings": timings}


def _save_stage(store: Store, stage: str, run_id: str, tables: dict) -> None:
    for prefix in (f"curated/{stage}/{run_id}/", f"curated/{stage}/latest/"):
        store.write_tables(prefix, tables)


def _save_json(store: Store, stage: str, run_id: str, name: str, payload) -> None:
    for prefix in (f"curated/{stage}/{run_id}/", f"curated/{stage}/latest/"):
        store.write_json(f"{prefix}{name}.json", payload)


def _load_stage(store: Store, stage: str, required: bool = True) -> dict:
    tables = store.read_tables(f"curated/{stage}/latest/")
    if required and not tables:
        raise RuntimeError(f"no saved '{stage}' output yet; include that stage in the run")
    return tables


# ---------------------------------------------------------------- entry point
def lambda_handler(event, context=None):
    event = event or {}
    cfg = config.load(event)          # fails fast on a wrong setting
    store = Store(cfg)
    mode = "file" if "Records" in event else event.get("mode", "full")
    if mode == "selfcheck":
        return selfcheck.run(cfg, store, context)
    try:
        if mode == "file":
            return run_file_mode(cfg, store, event, context)
        if mode == "full":
            return run_full_mode(cfg, store, event)
        raise ValueError(f"unknown mode {mode!r}; use 'file', 'full' or 'selfcheck'")
    except Exception as exc:
        log.exception("pipeline failed")
        publish.notify(cfg, "LPS-Beacon pipeline FAILED", {"mode": mode, "error": str(exc)})
        raise
