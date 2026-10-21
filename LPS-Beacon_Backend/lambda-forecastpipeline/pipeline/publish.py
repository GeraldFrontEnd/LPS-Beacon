"""Stage 5: write results/ for the API Lambda, the dashboard and the chatbot.

results/<run_id>/
  manifest.json            run id, parameters, inputs, row counts, warnings, timings
  summary/<table>.json     aggregates only, no person names: the dashboard and the
                           Bedrock tools read these
  detail/<table>.json      matching sheets (Position Name can contain a person's
                           name): serve to unrestricted roles only
  finance/<table>.json     revenue, cost, P&L: serve to the finance group only
  forecast_result.xlsx     summary + detail workbook for download (no finance)
  finance_result.xlsx      finance workbook (only when rates were uploaded)
results/latest.json        pointer to the newest successful run, written LAST so the
                           app never sees a half-written run
"""
from __future__ import annotations

import datetime as dt
import io
import json
import logging
import uuid

import pandas as pd

from .config import Config
from .s3io import Store

log = logging.getLogger(__name__)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def new_run_id() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]


def _records(df: pd.DataFrame) -> list:
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            values = out[col]
            midnight = values.dropna().dt.normalize().eq(values.dropna()).all()
            out[col] = values.dt.strftime("%Y-%m-%d" if midnight else "%Y-%m-%dT%H:%M:%S")
    return json.loads(out.to_json(orient="records"))


def _workbook(tables: dict[str, pd.DataFrame]) -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, df in tables.items():
            out = df.copy()
            for col in out.columns:
                if isinstance(out[col].dtype, pd.DatetimeTZDtype):
                    out[col] = out[col].dt.tz_localize(None)
            out.to_excel(writer, sheet_name=name[:31], index=False)
    return buffer.getvalue()


def run(cfg: Config, store: Store, run_id: str, forecast_tables: dict, finance_tables: dict,
        matching_tables: dict, kpis: dict, manifest: dict) -> dict:
    base = f"results/{run_id}/"
    for name, df in forecast_tables.items():
        store.write_json(f"{base}summary/{name}.json", _records(df))
    store.write_json(f"{base}summary/kpis.json", kpis)
    for name, df in matching_tables.items():
        store.write_json(f"{base}detail/{name}.json", _records(df))
    for name, df in finance_tables.items():
        store.write_json(f"{base}finance/{name}.json", _records(df))

    store.write_bytes(base + "forecast_result.xlsx",
                      _workbook({**forecast_tables, **{f"m_{k}": v for k, v in matching_tables.items()}}),
                      XLSX)
    if finance_tables:
        store.write_bytes(base + "finance_result.xlsx", _workbook(finance_tables), XLSX)

    manifest = {**manifest, "runId": run_id, "kpis": kpis,
                "files": {"summary": sorted(forecast_tables) + ["kpis"],
                          "detail": sorted(matching_tables), "finance": sorted(finance_tables)},
                "publishedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    store.write_json(base + "manifest.json", manifest)
    store.write_json("results/latest.json", {"runId": run_id, "prefix": base,
                                              "asOf": kpis.get("asOf"),
                                              "trigger": manifest.get("trigger"),
                                              "batchId": manifest.get("batchId"),
                                              "publishedAt": manifest["publishedAt"]})
    return manifest


def notify(cfg: Config, subject: str, message: dict) -> None:
    """Emails the SNS topic. A failed email never fails the pipeline."""
    if not cfg.alert_topic_arn or cfg.local_data_dir:
        log.info("notify (no SNS): %s %s", subject, message)
        return
    try:
        import boto3
        boto3.client("sns", region_name=cfg.bucket_region).publish(
            TopicArn=cfg.alert_topic_arn, Subject=subject[:100],
            Message=json.dumps(message, indent=2, default=str))
    except Exception:  # noqa: BLE001 - email is best effort
        log.exception("SNS publish failed")
