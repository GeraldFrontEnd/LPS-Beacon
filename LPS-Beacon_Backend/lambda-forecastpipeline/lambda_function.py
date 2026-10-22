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
  Capacity plan inputs (after changing pipeline/plan_settings.py)   {"mode": "capacity_inputs"}
      rebuilds results/capacity/inputs.json; it is also rebuilt after a UR report or staff list is
      cleaned and after every published run (see pipeline/capacity.py)

  Review of the data already uploaded (from the API Lambda; no new files)
      {"mode": "review_start", "batchId": "<user>/<yyyy-mm-dd>/<id>", "requestedBy": "..."}
                                                       starts the same review on the latest clean/ data

  Review decision (from the API Lambda, see pipeline/review.py)
      {"mode": "review", "batchId": "...", "step": "conflicts" | "forecast" | "matching",
       "decisions": {...}}                             continues a paused upload review

With REVIEW_ON_UPLOAD=true (default) an upload does not run straight through: it pauses three
times for the user (conflicts -> opportunity forecast -> matching), see pipeline/review.py.
With REVIEW_ON_UPLOAD=false it runs match -> forecast -> publish at once, as before.

Optional event fields: "asOf": "2026-09-01" (planning date), "requestedBy": "email".
Reserved concurrency 1 makes invocations run one at a time, so uploads, scheduled and
on-demand runs never write results/ at the same time.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import re
import time

import pandas as pd
from urllib.parse import unquote_plus

from pipeline import (batch, capacity, clean, config, crossval, forecast, matching, opportunities, publish, review,
                      selfcheck, validate)
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


CAPACITY_DATASETS = ("bu_ur", "staff_list")


def _refresh_capacity_inputs(store: Store) -> None:
    """Rebuilds the capacity plan's inputs. A failure is logged, never fatal: the files stay cleaned."""
    try:
        capacity.write(store)
        _log("capacity_inputs_written", key=capacity.KEY)
    except Exception:  # noqa: BLE001
        log.exception("capacity plan inputs could not be rebuilt")


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
    if any(r.get("status") == "cleaned" and r.get("dataset") in CAPACITY_DATASETS for r in results):
        _refresh_capacity_inputs(store)

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
    if not processed and not any(not batch.is_control_file(k) for k, _ in objects):
        # Only the manifest is there so far (it is written before the first file): wait for the files.
        batch.set_run(store, status, "waiting_for_files", "waiting for the uploaded files")
        return {"batchId": batch_id, "state": "waiting_for_files"}
    if not any(f.get("status") == "cleaned" for f in processed):
        batch.set_run(store, status, "not_run", "every file in this upload was rejected; see the reasons")
        return {"batchId": batch_id, "state": "not_run"}
    if not batch.review_wanted(store, prefix):
        cleaned = sum(1 for f in processed if f.get("status") == "cleaned")
        batch.set_run(store, status, "saved", f"{cleaned} file{'' if cleaned == 1 else 's'} checked and saved; "
                                              "no review was started")
        _log("upload_saved_without_review", batchId=batch_id, files=cleaned)
        return {"batchId": batch_id, "state": "saved"}
    missing = _missing_inputs(store)
    if missing:
        batch.set_run(store, status, "waiting_for_inputs",
                      f"upload a {' and a '.join(missing)} to run the forecast")
        return {"batchId": batch_id, "state": "waiting_for_inputs"}

    if cfg.review_on_upload:
        return _start_review_safely(cfg, store, batch_id)

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


def _missing_inputs(store: Store) -> list[str]:
    """The inputs a review can't run without, by name, when they were never cleaned."""
    return [name for name, key in (("resource plan", "clean/resource_plan/latest_wide.json.gz"),
                                   ("quote line", "clean/quoteline/latest_wide.json.gz"))
            if not store.exists(key)]


def _start_review_safely(cfg, store: Store, batch_id: str) -> dict:
    try:
        return start_review(cfg, store, batch_id)
    except Exception as exc:  # noqa: BLE001 - the status file tells the user; a retry would not help
        log.exception("review failed to start")
        publish.notify(cfg, "LPS-Beacon pipeline FAILED", {"batchId": batch_id, "error": str(exc)})
        batch.set_run(store, _status(store, batch_id), "failed", str(exc))
        return {"batchId": batch_id, "state": "failed", "error": str(exc)}


# ---------------------------------------------------------------- REVIEW of the data already uploaded
STORED_BATCH_ID = re.compile(r"[A-Za-z0-9@._+-]{1,128}/\d{4}-\d{2}-\d{2}/[A-Za-z0-9-]{8,64}")


def stored_files(store: Store) -> list[dict]:
    """One entry per dataset in clean/: the file it was last cleaned from, and when."""
    files = []
    for dataset in clean.DATASETS:
        quality = store.read_json_or(f"clean/{dataset}/latest.quality.json", None)
        if not quality:
            continue
        source = str(quality.get("sourceKey") or dataset)
        files.append({"key": source, "name": batch.file_name(source), "status": "cleaned", "dataset": dataset,
                      "cleanedAt": quality.get("cleanedAt"), "warnings": quality.get("warnings") or [],
                      "reason": None, "at": batch.now_iso()})
    return files


def run_review_start(cfg, store: Store, event: dict) -> dict:
    """A review on the latest cleaned data, without uploading the files again. Uses the same status file and
    review steps as an upload, so the review page follows it the same way."""
    batch_id = str(event.get("batchId") or "")
    if not STORED_BATCH_ID.fullmatch(batch_id) or ".." in batch_id:
        raise ValueError("review_start needs a batchId like <user>/<yyyy-mm-dd>/<id>")
    if store.exists(batch.status_key(batch_id)):
        # The async retry of an invocation that already started this review: don't start it twice.
        _log("review_start_ignored", batchId=batch_id)
        return {"batchId": batch_id, "state": "ignored"}
    status = batch.load_status(store, batch_id, f"raw/{batch_id}/")
    status.update(source="stored", uploadedBy=event.get("requestedBy") or status["uploadedBy"],
                  files=stored_files(store), expectedFiles=None)
    _log("review_start", batchId=batch_id, datasets=[f["dataset"] for f in status["files"]])
    missing = _missing_inputs(store)
    if missing:
        batch.set_run(store, status, "waiting_for_inputs",
                      f"no {' or '.join(missing)} has been uploaded yet; upload one to start a review")
        return {"batchId": batch_id, "state": "waiting_for_inputs"}
    batch.set_run(store, status, "running", "loading the data already uploaded")
    return _start_review_safely(cfg, store, batch_id)


# ---------------------------------------------------------------- REVIEW flow (after an upload)
def _status(store: Store, batch_id: str) -> dict:
    return batch.load_status(store, batch_id, f"raw/{batch_id}/")


def _pause(store: Store, batch_id: str, step: str, payload: dict, message: str) -> dict:
    """Writes what the review page shows for this step and marks the upload as waiting for it."""
    store.write_json(review.review_key(batch_id, step), review.plain(payload))
    batch.set_run(store, _status(store, batch_id), "awaiting_review", message, step=step,
                  reviewKey=review.review_key(batch_id, step))
    _log("review_paused", batchId=batch_id, step=step)
    return {"batchId": batch_id, "state": "awaiting_review", "step": step}


def _decisions(store: Store, batch_id: str, step: str) -> dict:
    return store.read_json_or(f"{review.work_prefix(batch_id)}decisions/{step}.json", {})


def _prepared_inputs(cfg, store: Store, batch_id: str, with_pipeline: bool = True) -> tuple[dict, list[str]]:
    """The latest clean data with the review's choices applied: conflict values, and the accepted
    pipeline demand added to the quote lines."""
    inputs = review.load_inputs(store)
    work = review.work_prefix(batch_id)
    notes = crossval.apply(inputs, store.read_json_or(work + "conflicts.json", []),
                           (_decisions(store, batch_id, "conflicts").get("choices") or {}))
    if with_pipeline:
        opps = store.read_json_or(work + "opportunities.json", [])
        accepted = review.accepted_resources(opps, _decisions(store, batch_id, "forecast"))
        if accepted:
            ql = inputs["quoteline"]
            extra = review.pipeline_quote_rows(accepted, ql["wide"], cfg.ql_full_month_mds)
            ql["wide"] = pd.concat([ql["wide"], extra], ignore_index=True)
            ql["long"] = pd.concat([ql["long"], clean.to_long(extra, "quoteline", cfg.ql_full_month_mds)],
                                   ignore_index=True)
            notes.append(f"{len(accepted)} accepted pipeline resources added to the demand")
    # The matching script must see these edited tables, not the original uploads.
    for dataset in ("resource_plan", "quoteline"):
        inputs[dataset]["quality"] = {**inputs[dataset]["quality"], "sourceKey": None}
    return inputs, notes


def start_review(cfg, store: Store, batch_id: str) -> dict:
    """Review step 1: conflicts between the files. Skipped (straight to step 2) when there are none."""
    batch.set_run(store, _status(store, batch_id), "running", "cross-validating the uploaded files")
    inputs = review.load_inputs(store)
    conflicts = crossval.find(inputs)
    store.write_json(review.work_prefix(batch_id) + "conflicts.json", review.plain(conflicts))
    if conflicts:
        shown = [{k: v for k, v in c.items() if k != "kind"} for c in conflicts]
        return _pause(store, batch_id, "conflicts", {"conflicts": shown},
                      f"{len(conflicts)} conflict(s) between files need a decision")
    return forecast_step(cfg, store, batch_id)


def forecast_step(cfg, store: Store, batch_id: str) -> dict:
    """Review step 2: the resources each pipeline opportunity needs."""
    batch.set_run(store, _status(store, batch_id), "running", "forecasting resource needs for pipeline opportunities")
    inputs, notes = _prepared_inputs(cfg, store, batch_id, with_pipeline=False)
    opps, opp_notes = opportunities.run(cfg, inputs)
    store.write_json(review.work_prefix(batch_id) + "opportunities.json", review.plain(opps))
    return _pause(store, batch_id, "forecast", {"opportunities": opps, "notes": notes + opp_notes},
                  f"forecast for {len(opps)} opportunities ready for review")


def matching_step(cfg, store: Store, batch_id: str) -> dict:
    """Review step 3: your matching script on current + accepted pipeline demand."""
    batch.set_run(store, _status(store, batch_id), "running", "matching demand to available resources")
    inputs, notes = _prepared_inputs(cfg, store, batch_id)
    tables, warnings = matching.run(cfg, inputs, store=None)
    work = review.work_prefix(batch_id)
    store.write_tables(work + "matching/", tables)
    opps = store.read_json_or(work + "opportunities.json", [])
    payload = review.matching_review(tables.get("matching"), cfg.grade_tolerance, cfg.max_idle_months, opps)
    payload["notes"] = notes + warnings
    return _pause(store, batch_id, "matching", payload,
                  f"matching list with {len(payload['lines'])} demand lines ready for review")


def finish_review(cfg, store: Store, batch_id: str) -> dict:
    """After the matching is confirmed: hiring gap, availability forecast and publish, as a normal run."""
    work = review.work_prefix(batch_id)
    tables = store.read_tables(work + "matching/")
    reviewed = review.reviewed_tables(tables, _decisions(store, batch_id, "matching"))
    reviewed.setdefault("matching", pd.DataFrame())
    run_id = publish.new_run_id()
    _save_stage(store, "matching", run_id, reviewed)
    _save_json(store, "matching", run_id, "run", {"runId": run_id, "asOf": cfg.as_of.isoformat(),
                                                  "batchId": batch_id, "reviewed": True})
    inputs, _ = _prepared_inputs(cfg, store, batch_id)
    gap = review.hiring_gap(reviewed["matching"], cfg.ql_full_month_mds)
    status = _status(store, batch_id)
    trigger = "stored_review" if status.get("source") == "stored" else "upload"
    return run_full_mode(cfg, store, {"mode": "full", "stages": ["forecast", "publish"], "trigger": trigger,
                                      "batchId": batch_id, "requestedBy": status.get("uploadedBy")},
                         prepared_inputs=inputs, extra_summary={"hiring_gap": gap})


def accepts_decision(run: dict, step: str, decisions: dict) -> bool:
    """Whether the review can take a decision for this step now: the step it is waiting for, or the forecast
    again while it waits for the matching, when the page says so with "redo": true (the user went back to change
    the forecast; the matching is redone). Without the flag, a late copy of the first forecast message is ignored."""
    if run.get("state") != "awaiting_review":
        return False
    if run.get("step") == step:
        return True
    return step == "forecast" and run.get("step") == "matching" and decisions.get("redo") is True


def run_review_mode(cfg, store: Store, event: dict) -> dict:
    """A decision from the review page. Ignored unless the review can take it now (see accepts_decision),
    so a repeated or late message can't move the review twice."""
    batch_id, step = str(event.get("batchId") or ""), str(event.get("step") or "")
    if step not in review.STEPS or not batch_id:
        raise ValueError(f"review events need a batchId and a step in {review.STEPS}")
    run = _status(store, batch_id).get("run", {})
    if not accepts_decision(run, step, event.get("decisions") or {}):
        _log("review_ignored", batchId=batch_id, step=step, state=run.get("state"), waiting_for=run.get("step"))
        return {"batchId": batch_id, "state": run.get("state"), "ignored": True}
    decisions = event.get("decisions") or {}
    store.write_json(f"{review.work_prefix(batch_id)}decisions/{step}.json",
                     {**decisions, "by": event.get("requestedBy"), "at": batch.now_iso()})
    _log("review_decided", batchId=batch_id, step=step, by=event.get("requestedBy"),
         redo=run.get("step") != step)
    try:
        if step == "conflicts":
            return forecast_step(cfg, store, batch_id)
        if step == "forecast":
            return matching_step(cfg, store, batch_id)
        if decisions.get("rejectedAll"):
            batch.set_run(store, _status(store, batch_id), "ended",
                          "the matching list was rejected; nothing from this upload was used")
            return {"batchId": batch_id, "state": "ended"}
        batch.set_run(store, _status(store, batch_id), "running", "calculating hiring demand and publishing")
        result = finish_review(cfg, store, batch_id)
        return {"batchId": batch_id, "state": "published", "runId": result["runId"]}
    except Exception as exc:
        log.exception("review step failed")
        batch.set_run(store, _status(store, batch_id), "failed", str(exc))
        raise


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


def run_full_mode(cfg, store: Store, event: dict, prepared_inputs: dict | None = None,
                  extra_summary: dict | None = None) -> dict:
    """prepared_inputs / extra_summary: used by the review flow (the reviewed inputs, and the hiring gap)."""
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
        inputs = prepared_inputs if prepared_inputs is not None else timed("load", lambda: clean.load_latest(store))
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
            if extra_summary:
                fc_tables.update(extra_summary)
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
            _refresh_capacity_inputs(store)
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
        if mode == "review":
            return run_review_mode(cfg, store, event)
        if mode == "review_start":
            return run_review_start(cfg, store, event)
        if mode == "capacity_inputs":
            inputs = capacity.write(store)
            return {"mode": mode, "key": capacity.KEY, "notes": inputs["notes"]}
        raise ValueError(f"unknown mode {mode!r}; use 'file', 'full', 'review', 'review_start', "
                         "'capacity_inputs' or 'selfcheck'")
    except Exception as exc:
        log.exception("pipeline failed")
        publish.notify(cfg, "LPS-Beacon pipeline FAILED", {"mode": mode, "error": str(exc)})
        raise
