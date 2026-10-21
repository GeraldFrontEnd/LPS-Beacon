"""Tests for lambda-forecastpipeline. Run from the package folder:

    python -m unittest discover -s tests -v

They use a temporary local folder instead of S3, so no AWS account and no real data
are needed. Most tests use the example matching script; RealMatchingScriptTests runs
matching_python_script.py itself (skipped if scipy / scikit-learn are not installed).
"""
import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import clean, config, fiscal, forecast, validate  # noqa: E402
from pipeline.s3io import Store  # noqa: E402

MONTHS_RP = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


def rp_csv(rows=None) -> bytes:
    header = (["Project ID", "Work Order", "Resource", "Grade", "Skill", "Position Name",
               "Working City", "Fiscal Year"] + MONTHS_RP +
              ["Status", "Created By", "Created On", "Quote Line Number", "Project Status", "Customer",
               "Project Type", "End Customer", "Quote ID", "Project Name", "Project Owner",
               "Modified Date", "SFDC numbers", "Contract Number"])
    rows = rows or [
        ["PROJ-1", "", "Generic Resource 6", "6", "", "Server Engineer", "SG - Singapore", "FY26"]
        + [""] * 4 + ["18"] * 7
        + ["Active", "A", "46274", "QL-1", "Active", "CUST", "Time Based", "CUST", "QUO-1",
           "Proj One", "Owner", "09/15/2026 17:05:08", "", "ORD-1"],
    ]
    # two identical rows = two people; they must both survive cleaning
    rows = rows + [rows[0]]
    return pd.DataFrame(rows, columns=header).to_csv(index=False).encode("cp1252")


def ql_csv() -> bytes:
    header = (["Project ID", "Work Order", "Quote Line Number", "Resource", "Grade", "Skill",
               "Position Name", "Working City", "Fiscal Year"] + fiscal.FY_MONTHS +
              ["Status", "Created By", "Created On", "Name", "Customer", "End Customer",
               "Project Type", "Quote ID", "Contract Number"])
    row = (["", "", "QL-1", "Generic Resource", "6", "BAU", "Server Engineer", "SG - Singapore", "FY26"]
           + ["18.5"] * 12 + ["Active", "B", "45711", "Proj One", "CUST", "CUST", "Time Based",
                              "QUO-1", "ORD-1"])
    return pd.DataFrame([row], columns=header).to_csv(index=False).encode("utf-8")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["LOCAL_DATA_DIR"] = self.tmp.name
        os.environ["MATCHING_SCRIPT"] = str(ROOT / "example_matching_script.py")
        os.environ.pop("AS_OF_DATE", None)
        os.environ["UPLOAD_SETTLE_SECONDS"] = "0"
        os.environ.pop("AUTO_RUN_ON_UPLOAD", None)
        self.cfg = config.load({"asOf": "2026-09-01"})
        self.store = Store(self.cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, name: str, data: bytes, batch: str = "") -> str:
        folder = f"{batch}/" if batch else ""
        key = f"raw/user@example.com/2026-10-20/{folder}abc-{name}"
        self.store.write_bytes(key, data)
        return key


class FiscalTests(unittest.TestCase):
    def test_months_and_quarters(self):
        self.assertEqual(fiscal.month_start("FY26", "Apr"), dt.date(2026, 4, 1))
        self.assertEqual(fiscal.month_start("FY26", "Mar"), dt.date(2027, 3, 1))
        self.assertEqual(fiscal.fy_label(dt.date(2027, 3, 1)), "FY26")
        self.assertEqual(fiscal.quarter(dt.date(2026, 4, 1)), "Q1")
        self.assertEqual(fiscal.quarter(dt.date(2027, 1, 1)), "Q4")
        self.assertEqual(fiscal.half(dt.date(2026, 10, 1)), "H2")
        self.assertIsNone(fiscal.fy_start_year("2026"))


class ConfigTests(unittest.TestCase):
    def test_bucket_arn_rejected(self):
        saved = dict(os.environ)
        try:
            os.environ.pop("LOCAL_DATA_DIR", None)
            os.environ["DATA_BUCKET"] = "arn:aws:s3:::lps-beacon-data"
            os.environ["BUCKET_REGION"] = "ap-southeast-1"
            with self.assertRaises(config.ConfigError):
                config.load()
        finally:
            os.environ.clear()
            os.environ.update(saved)


class ValidateTests(Base):
    def test_binary_csv_rejected(self):
        key = self.put("x.csv", b"abc\x00\x01def")
        with self.assertRaises(validate.Rejected):
            validate.run(self.cfg, self.store, key)

    def test_unreadable_types_rejected(self):
        key = self.put("x.xlsb", b"PK whatever")
        with self.assertRaises(validate.Rejected):
            validate.run(self.cfg, self.store, key)

    def test_macro_workbook_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("[Content_Types].xml", "x")
            z.writestr("xl/workbook.xml", "x")
            z.writestr("xl/vbaProject.bin", "x")
        key = self.put("x.xlsm", buffer.getvalue())
        with self.assertRaises(validate.Rejected):
            validate.run(self.cfg, self.store, key)

    def test_zip_bomb_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", "x")
            z.writestr("xl/big.xml", b"0" * (5 * 1024 * 1024))
        key = self.put("x.xlsx", buffer.getvalue())
        with self.assertRaises(validate.Rejected):
            validate.run(self.cfg, self.store, key)

    def test_quarantine_writes_reason(self):
        key = self.put("x.csv", b"abc")
        target = validate.quarantine(self.store, key, "test reason")
        self.assertTrue(target.startswith("quarantine/user@example.com/"))
        self.assertEqual(self.store.read_json(target + ".reason.json")["reason"], "test reason")


class CleanTests(Base):
    def test_resource_plan_cleaned(self):
        key = self.put("rp.csv", rp_csv())
        data = validate.run(self.cfg, self.store, key)
        quality = clean.run_file(self.cfg, self.store, key, data, ".csv")
        self.assertEqual(quality["dataset"], "resource_plan")
        self.assertEqual(quality["rowsOut"], 2, "identical rows are separate people")
        self.assertTrue(any("Apr" in w for w in quality["warnings"]))
        wide = self.store.read_table("clean/resource_plan/latest_wide.json.gz")
        self.assertEqual(wide["_row_id"].nunique(), 2)
        self.assertEqual(str(pd.Timestamp(wide["Created On"][0]).date()), "2026-09-09")
        long = self.store.read_table("clean/resource_plan/latest_long.json.gz")
        self.assertEqual(pd.Timestamp(long["month"].max()).date(), dt.date(2027, 3, 1))
        self.assertAlmostEqual(long["fte"].iloc[0], 1.0)

    def test_quoteline_detected(self):
        key = self.put("ql.csv", ql_csv())
        quality = clean.run_file(self.cfg, self.store, key, validate.run(self.cfg, self.store, key), ".csv")
        self.assertEqual(quality["dataset"], "quoteline")

    def test_unknown_columns_raise(self):
        with self.assertRaises(clean.CleanError):
            clean.detect({"csv": pd.DataFrame({"a": [1]})})


class ForecastTests(unittest.TestCase):
    def test_renewal_projection_only_for_active_fy_end_lines(self):
        long = pd.DataFrame({
            "row_id": ["A", "A", "B"], "project_id": ["P"] * 3, "quote_line": ["Q"] * 3,
            "position_name": ["X", "X", "Y"], "resource": ["R"] * 3, "grade": [6, 6, 6],
            "month": pd.to_datetime(["2027-02-01", "2027-03-01", "2026-03-01"]),
            "mds": [18.0, 18.0, 18.0], "fte": [1.0, 1.0, 1.0], "fy_month": ["Feb", "Mar", "Mar"],
        })
        proj = forecast.project_renewals(long, dt.date(2026, 9, 1), 12, 0.8)
        self.assertEqual(set(proj["row_id"]), {"A"}, "B ended before the planning date")
        self.assertEqual(len(proj), 5)  # Apr..Aug 2027
        self.assertAlmostEqual(proj["fte"].iloc[0], 0.8)


class HandlerTests(Base):
    def test_s3_event_key_is_url_decoded_and_full_run_publishes(self):
        import lambda_function
        key_rp = self.put("Project Resource Plan.csv", rp_csv())
        key_ql = self.put("ql.csv", ql_csv())
        event = {"Records": [{"eventSource": "aws:s3",
                              "s3": {"object": {"key": key_rp.replace(" ", "+")}}}]}
        result = lambda_function.lambda_handler(event)
        self.assertEqual(result["files"][0]["status"], "cleaned")
        lambda_function.lambda_handler({"mode": "file", "key": key_ql})

        run = lambda_function.lambda_handler({"mode": "full", "asOf": "2026-09-01"})
        latest = self.store.read_json("results/latest.json")
        self.assertEqual(latest["runId"], run["runId"])
        kpis = self.store.read_json(latest["prefix"] + "summary/kpis.json")
        self.assertEqual(kpis["asOf"], "2026-09-01")
        variance = self.store.read_json(latest["prefix"] + "summary/project_variance.json")
        self.assertTrue(variance and "variance_mds" in variance[0])

        again = lambda_function.lambda_handler({"mode": "full", "stages": ["forecast", "publish"]})
        self.assertEqual(again["stages"], ["forecast", "publish"])

    def test_full_run_without_uploads_fails_clearly(self):
        import lambda_function
        with self.assertRaises(clean.CleanError):
            lambda_function.lambda_handler({"mode": "full"})


def s3_event(key: str) -> dict:
    return {"Records": [{"eventSource": "aws:s3", "eventName": "ObjectCreated:Put",
                         "s3": {"object": {"key": key.replace(" ", "+")}}}]}


def rp_csv_ending_aug() -> bytes:
    """One Server Engineer, grade 6, last man-days in Aug 2026 -> available from Sep 2026."""
    row = (["PROJ-1", "", "Generic Resource 6", "6", "Linux servers", "Server Engineer", "SG", "FY26"]
           + ["18"] * 4 + [""] * 7
           + ["Active", "A", "46274", "QL-1", "Active", "CUST", "Time Based", "CUST", "QUO-1",
              "Proj One", "Owner", "09/15/2026 17:05:08", "", "ORD-1"])
    return rp_csv([row])


def ql_csv_starting_oct() -> bytes:
    header = (["Project ID", "Work Order", "Quote Line Number", "Resource", "Grade", "Skill",
               "Position Name", "Working City", "Fiscal Year"] + fiscal.FY_MONTHS +
              ["Status", "Created By", "Created On", "Name", "Customer", "End Customer",
               "Project Type", "Quote ID", "Contract Number"])
    row = (["PROJ-2", "", "QL-2", "Generic Resource", "6", "Linux servers", "Server Engineer", "SG", "FY26"]
           + [""] * 6 + ["18.5"] * 6 + ["Active", "B", "45711", "Proj Two", "CUST", "CUST", "Time Based",
                                         "QUO-2", "ORD-2"])
    return pd.DataFrame([row], columns=header).to_csv(index=False).encode("utf-8")


def mapping_xlsx() -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        pd.DataFrame({"Standard Role": ["Server Engineer", "Project Manager"]}).to_excel(
            writer, sheet_name="Standard Role", index=False)
        pd.DataFrame({"Position Name": ["Server Engineer"], "Standard Role": ["Server Engineer"]}).to_excel(
            writer, sheet_name="Position Name Mapping", index=False)
    return buffer.getvalue()


class UploadTriggerTests(Base):
    """An upload batch runs match -> forecast -> publish once, after its last file."""

    def status(self, batch="b1"):
        return self.store.read_json(f"results/uploads/user@example.com/2026-10-20/{batch}/status.json")

    def test_last_file_of_batch_starts_one_run(self):
        import lambda_function
        k1 = self.put("Project Resource Plan.csv", rp_csv(), batch="b1")
        k2 = self.put("ql.csv", ql_csv(), batch="b1")
        first = lambda_function.lambda_handler(s3_event(k1))
        self.assertEqual(first["batches"][0]["state"], "waiting_for_files")
        self.assertFalse(self.store.exists("results/latest.json"), "no run on half an upload")
        second = lambda_function.lambda_handler(s3_event(k2))
        self.assertEqual(second["batches"][0]["state"], "published")
        status = self.status()
        self.assertEqual(status["run"]["state"], "published")
        self.assertEqual({f["status"] for f in status["files"]}, {"cleaned"})
        latest = self.store.read_json("results/latest.json")
        self.assertEqual((latest["trigger"], latest["batchId"]),
                         ("upload", "user@example.com/2026-10-20/b1"))
        self.assertEqual(status["run"]["resultsPrefix"], latest["prefix"])

    def test_rejected_file_does_not_block_the_batch(self):
        import lambda_function
        k1 = self.put("rp.csv", rp_csv(), batch="b1")
        k2 = self.put("ql.csv", ql_csv(), batch="b1")
        k3 = self.put("bad.csv", b"abc\x00def", batch="b1")
        for key in (k1, k2):
            lambda_function.lambda_handler(s3_event(key))
        last = lambda_function.lambda_handler(s3_event(k3))
        self.assertEqual(last["files"][0]["status"], "quarantined")
        self.assertEqual(last["batches"][0]["state"], "published")

    def test_only_rejected_files_means_no_run(self):
        import lambda_function
        key = self.put("bad.csv", b"abc\x00def", batch="b2")
        result = lambda_function.lambda_handler(s3_event(key))
        self.assertEqual(result["batches"][0]["state"], "not_run")

    def test_waits_for_inputs_when_no_plan_exists(self):
        import lambda_function
        key = self.put("ql.csv", ql_csv(), batch="b3")
        result = lambda_function.lambda_handler(s3_event(key))
        self.assertEqual(result["batches"][0]["state"], "waiting_for_inputs")
        self.assertIn("resource plan", self.status("b3")["run"]["message"])

    def test_manifest_waits_for_expected_count(self):
        import lambda_function
        self.store.write_bytes("raw/user@example.com/2026-10-20/b4/_batch.json", b'{"expectedFiles": 3}')
        k1 = self.put("rp.csv", rp_csv(), batch="b4")
        k2 = self.put("ql.csv", ql_csv(), batch="b4")
        lambda_function.lambda_handler(s3_event(k1))
        result = lambda_function.lambda_handler(s3_event(k2))
        self.assertEqual(result["batches"][0]["state"], "waiting_for_files", "2 of 3 expected")

    def test_auto_run_can_be_switched_off(self):
        import lambda_function
        os.environ["AUTO_RUN_ON_UPLOAD"] = "false"
        key = self.put("rp.csv", rp_csv(), batch="b5")
        result = lambda_function.lambda_handler(s3_event(key))
        self.assertEqual(result["batches"][0]["state"], "disabled")
        self.assertFalse(self.store.exists("results/latest.json"))


class PlanningDateTests(Base):
    def setUp(self):
        super().setUp()
        import lambda_function
        self.lf = lambda_function
        for name, data in (("rp.csv", rp_csv()), ("ql.csv", ql_csv())):
            self.lf.lambda_handler({"mode": "file", "key": self.put(name, data), "autoRun": False})
        self.lf.lambda_handler({"mode": "full", "asOf": "2026-09-01"})

    def test_forecast_only_reuses_matching_date(self):
        result = self.lf.lambda_handler({"mode": "full", "stages": ["forecast", "publish"]})
        self.assertEqual(result["asOf"], "2026-09-01")

    def test_conflicting_date_is_refused(self):
        with self.assertRaises(ValueError):
            self.lf.lambda_handler({"mode": "full", "stages": ["forecast", "publish"], "asOf": "2026-11-01"})

    def test_stage_gap_is_refused(self):
        with self.assertRaises(ValueError):
            self.lf.lambda_handler({"mode": "full", "stages": ["match", "publish"]})


class MissingMonthTests(Base):
    def test_missing_april_is_no_data_not_zero(self):
        import lambda_function
        for name, data in (("rp.csv", rp_csv()), ("ql.csv", ql_csv())):
            lambda_function.lambda_handler({"mode": "file", "key": self.put(name, data), "autoRun": False})
        lambda_function.lambda_handler({"mode": "full", "asOf": "2026-09-01"})
        prefix = self.store.read_json("results/latest.json")["prefix"]
        monthly = pd.DataFrame(self.store.read_json(prefix + "summary/headcount_monthly.json"))
        april = monthly[monthly["month"] == "2027-04-01"]
        self.assertTrue(len(april) and april["supply_fte"].isna().all() and april["supply_data_missing"].all())
        self.assertTrue(april["demand_fte"].notna().all(), "quote lines do have April")
        kpis = self.store.read_json(prefix + "summary/kpis.json")
        self.assertIn("2027-04", kpis["next12m"]["monthsWithoutData"])
        self.assertNotEqual(kpis["next12m"]["worstMonth"], "2027-04")
        self.assertEqual(kpis["dataGaps"]["resourcePlanMissingMonths"], ["Apr"])


class EncryptionConfigTests(unittest.TestCase):
    def test_sse_settings(self):
        saved = dict(os.environ)
        try:
            os.environ["LOCAL_DATA_DIR"] = tempfile.gettempdir()
            for value, expected in (("", ""), ("aes256", "AES256"), ("aws:kms", "aws:kms")):
                os.environ["S3_SSE"] = value
                self.assertEqual(config.load().s3_sse, expected)
            os.environ["S3_SSE"] = "kms"
            with self.assertRaises(config.ConfigError):
                config.load()
        finally:
            os.environ.clear()
            os.environ.update(saved)


class MatchingAdapterTests(Base):
    def test_script_exit_becomes_matching_error(self):
        from pipeline import matching
        script = Path(self.tmp.name) / "exits.py"
        script.write_text("import sys\ndef run_matching(rp_df):\n    print('WARNING: careful')\n"
                          "    sys.exit('ERROR: bad input')\n")
        cfg = config.load({"asOf": "2026-09-01"})
        object.__setattr__(cfg, "matching_script", str(script))
        inputs = {"resource_plan": {"wide": pd.DataFrame({"_row_id": [1]})},
                  "quoteline": {"wide": pd.DataFrame({"_row_id": [1]})}}
        with self.assertRaisesRegex(matching.MatchingError, "^bad input$"):
            matching.run(cfg, inputs)


try:
    import scipy  # noqa: F401
    import sklearn  # noqa: F401
    HAVE_SCIENCE = True
except ImportError:
    HAVE_SCIENCE = False


@unittest.skipUnless(HAVE_SCIENCE, "scipy / scikit-learn not installed")
class RealMatchingScriptTests(Base):
    def test_upload_runs_your_matching_script(self):
        import lambda_function
        os.environ["MATCHING_SCRIPT"] = str(ROOT / "matching_script.py")
        keys = [self.put("rp.csv", rp_csv_ending_aug(), batch="r1"),
                self.put("ql.csv", ql_csv_starting_oct(), batch="r1"),
                self.put("Position Name Mapping.xlsx", mapping_xlsx(), batch="r1")]
        for key in keys:
            result = lambda_function.lambda_handler({**s3_event(key), "asOf": "2026-09-01"})
        self.assertEqual(result["batches"][0]["state"], "published", result)
        prefix = self.store.read_json("results/latest.json")["prefix"]
        kpis = self.store.read_json(prefix + "summary/kpis.json")
        self.assertEqual(kpis["matched"], 1)
        for table in ("availability_forecast", "forecast_6_12m_summary", "availability_by_role"):
            self.assertTrue(self.store.exists(f"{prefix}summary/{table}.json"), table)
        matched = self.store.read_json(prefix + "detail/matched.json")
        self.assertEqual(matched[0]["QL | Standardized Position"], "Server Engineer")


if __name__ == "__main__":
    unittest.main()
