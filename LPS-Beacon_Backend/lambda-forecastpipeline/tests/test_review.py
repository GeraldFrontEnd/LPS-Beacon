"""Tests for the review flow after an upload (pipeline/review.py, crossval.py, opportunities.py).

    python -m unittest discover -s tests -v

The flow tests run matching_python_script.py itself, so they are skipped when scipy or
scikit-learn are not installed (like RealMatchingScriptTests).
"""
import io
import os
import unittest

import pandas as pd

from test_pipeline import (ROOT, Base, mapping_xlsx, ql_csv_starting_oct, rp_csv_ending_aug,  # noqa: F401
                           s3_event)

from pipeline import clean, crossval, opportunities, review  # noqa: E402

try:
    import scipy  # noqa: F401
    import sklearn  # noqa: F401
    HAVE_ML = True
except ImportError:
    HAVE_ML = False

SL_COLUMNS = ["Demand Type", "ID", "Name", "Customer", "Planned Start Date", "Planned End Date", "Resource",
              "IT Code", "Grade", "Skill", "Position Name", "Working City", "Calendar Date", "MD", "CRM ID"]


def sl_rp_csv() -> bytes:
    rows = []
    for month in ("2026-10-01", "2026-11-01", "2026-12-01"):       # QL-2 says band 7 here, band 6 in the quote line file
        rows.append(["Quote Won", "QL-2", "Proj Two", "CUST", "2026-10-01", "2027-03-31", "Generic Resource 758",
                     "", "7", "", "Server Engineer", "SG - Singapore", month, "18", "CRM-0"])
    for month in pd.date_range("2026-10-01", "2027-03-01", freq="MS"):   # CRM-1's own resource plan
        rows.append(["Quote O4", "QL-9", "Deal One", "CUST", "2026-10-01", "2027-03-31", "Generic Resource 758",
                     "", "6", "", "Server Engineer FY26", "SG - Singapore", month.strftime("%Y-%m-%d"), "18", "CRM-1"])
    rows.append(["Pre Sales", "PROJ-BID", "Bid team", "CUST", "", "", "Generic Resource 9", "bid1", "8", "",
                 "Solution Architect", "SG - Singapore", "2026-09-01", "5", "CRM-1"])
    for month in pd.date_range("2025-01-01", "2025-06-01", freq="MS"):   # a past project, copied for CRM-2
        rows.append(["Project", "PROJ-PAST", "Past Delivery Alpha", "CUST", "2025-01-01", "2025-06-30",
                     "Generic Resource 7", "code77", "7", "", "Project Manager", "SG - Singapore",
                     month.strftime("%Y-%m-%d"), "18", ""])
    return pd.DataFrame(rows, columns=SL_COLUMNS).to_csv(index=False).encode("utf-8")


def sfdc_xlsx() -> bytes:
    """Like the real export: a title block, then the header on row 12."""
    months = [f"{m:02d}/ {y} (converted)" for y, m in [(2026, 10), (2026, 11), (2026, 12), (2027, 1), (2027, 2), (2027, 3)]]
    header = ["CRM ID", "Opportunity Name (English)", "End Customer", "Stage", "Probability (%)", "TCV (converted)",
              "Expected Closed Date", "Major Solution Offering"] + months
    data = [
        ["CRM-1", "Deal One", "Cust A", "O4 - Customer Decision", 0.6, 100000, "30/9/2026", "ATFM"] + [10] * 6,
        ["CRM-2", "Past Delivery Alpha Renewal", "Cust B", "O3 - Solution", 0.4, 200000, "31/10/2026", "ATFM"] + [0, 5, 5, 5, 5, 5],
        ["CRM-3", "Something Else", "Cust C", "O2 - Qualify", 0.2, 5, "31/12/2026", "CRM"] + [0] * 6,
        ["CRM-4", "Lost Deal", "Cust D", "Closed Lost/Cancel", 0, 50000, "1/1/2026", "ATFM"] + [0] * 6,
    ]
    grid = [["", "YTD Pipeline (USD) -SEA"], ["", "As of 2026-09-14"], [], ["", "Filtered By"]] + [[]] * 7
    grid += [header] + data
    buffer = io.BytesIO()
    width = max(len(r) for r in grid)
    pd.DataFrame([list(r) + [None] * (width - len(r)) for r in grid]).to_excel(buffer, index=False, header=False)
    return buffer.getvalue()


def abcd_csv() -> bytes:
    return pd.DataFrame([{
        "Project_ID": "PROJ-PAST", "Project_Name": "Past Delivery Alpha", "SFDC_ID": "001X", "End_Customer": "Cust B",
        "Delivery_Region": "Singapore", "Service_Line": "ATFM", "Solution_Offering": "ATFM",
        "TCVBefore_Tax_USD_Currency_Contract": 210000, "Planned_Start": "2025-01-01", "Planned_End_Date": "2025-06-30",
        "Project_Duration_Months": 6}]).to_csv(index=False).encode("utf-8")


class DetectTests(Base):
    def test_new_files_are_recognised(self):
        self.assertEqual(clean.detect(clean.read_any(sl_rp_csv(), ".csv"))[0], "sl_rp")
        self.assertEqual(clean.detect(clean.read_any(abcd_csv(), ".csv"))[0], "abcd")
        dataset, sheets = clean.detect(clean.read_any(sfdc_xlsx(), ".xlsx"))
        self.assertEqual(dataset, "sfdc_pipeline")
        table, _ = clean.clean_sfdc(sheets["main"])
        self.assertEqual(list(table["CRM ID"]), ["CRM-1", "CRM-2", "CRM-3", "CRM-4"])
        self.assertEqual(table.loc[1, "Revenue From"], pd.Timestamp("2026-11-01"))
        self.assertEqual(table.loc[0, "Expected Closed Date"], pd.Timestamp("2026-09-30"))

    def test_edited_plan_files_use_the_file_name(self):
        plan = pd.read_csv(io.BytesIO(ql_csv_starting_oct())).drop(columns=["Name", "Apr"])
        data = plan.to_csv(index=False).encode()
        self.assertEqual(clean.detect(clean.read_any(data, ".csv"), "Quote_Line(Edited).csv")[0], "quoteline")
        self.assertEqual(clean.detect(clean.read_any(data, ".csv"), "Resource_Plan(Edited).csv")[0], "resource_plan")
        with self.assertRaises(clean.CleanError):
            clean.detect(clean.read_any(data, ".csv"), "export.csv")


@unittest.skipUnless(HAVE_ML, "scipy / scikit-learn not installed")
class ReviewFlowTests(Base):
    BATCH = "user@example.com/2026-10-20/r1"

    def setUp(self):
        super().setUp()
        os.environ["REVIEW_ON_UPLOAD"] = "true"
        os.environ["MATCHING_SCRIPT"] = str(ROOT / "matching_script.py")

    def upload_all(self):
        import lambda_function
        files = [("rp.csv", rp_csv_ending_aug()), ("ql.csv", ql_csv_starting_oct()),
                 ("Position Name Mapping.xlsx", mapping_xlsx()), ("SL_X_RP.csv", sl_rp_csv()),
                 ("YTD_Pipeline.xlsx", sfdc_xlsx()), ("ABCD.csv", abcd_csv())]
        keys = [self.put(name, data, batch="r1") for name, data in files]
        for key in keys:
            result = lambda_function.lambda_handler({**s3_event(key), "asOf": "2026-09-01"})
        return result

    def status(self):
        return self.store.read_json(f"results/uploads/{self.BATCH}/status.json")

    def payload(self, step):
        return self.store.read_json(review.review_key(self.BATCH, step))

    def decide(self, step, decisions):
        import lambda_function
        return lambda_function.lambda_handler({"mode": "review", "batchId": self.BATCH, "step": step,
                                               "decisions": decisions, "asOf": "2026-09-01"})

    def run_to_matching(self):
        self.upload_all()
        conflicts = self.payload("conflicts")["conflicts"]
        self.decide("conflicts", {"choices": {conflicts[0]["id"]: "a"}})
        opps = {o["crmId"]: o for o in self.payload("forecast")["opportunities"]}
        past = opps["CRM-2"]["resources"][0]["id"]
        self.decide("forecast", {"opportunities": {opps["CRM-1"]["id"]: "accepted", opps["CRM-2"]["id"]: "accepted",
                                                   opps["CRM-3"]["id"]: "rejected"},
                                 "edits": {past: {"grade": 6}}, "removed": []})
        return opps

    def test_upload_pauses_on_the_conflict(self):
        result = self.upload_all()
        self.assertEqual(result["batches"][0]["state"], "awaiting_review")
        run = self.status()["run"]
        self.assertEqual((run["state"], run["step"]), ("awaiting_review", "conflicts"))
        conflicts = self.payload("conflicts")["conflicts"]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["key"], "QL-2")
        self.assertEqual({o["value"] for o in conflicts[0]["options"]}, {"Band 6", "Band 7"})
        self.assertFalse(self.store.exists("results/latest.json"), "nothing is published before the review")

    def start_stored(self, batch_id):
        import lambda_function
        return lambda_function.lambda_handler({"mode": "review_start", "batchId": batch_id,
                                               "requestedBy": "user@example.com", "asOf": "2026-09-01"})

    def test_review_of_stored_data_needs_no_upload(self):
        import lambda_function
        self.upload_all()
        stored = "user@example.com/2026-10-21/stored-01"
        result = self.start_stored(stored)
        self.assertEqual(result["state"], "awaiting_review")
        status = self.store.read_json(f"results/uploads/{stored}/status.json")
        self.assertEqual(status["source"], "stored")
        self.assertEqual((status["run"]["state"], status["run"]["step"]), ("awaiting_review", "conflicts"))
        self.assertEqual({f["dataset"] for f in status["files"]},
                         {"resource_plan", "quoteline", "position_mapping", "sl_rp", "sfdc_pipeline", "abcd"})
        self.assertEqual({f["name"] for f in status["files"] if f["dataset"] == "abcd"}, {"abc-ABCD.csv"},
                         "each dataset names the file it was cleaned from")
        self.assertEqual(self.store.read_json(review.review_key(stored, "conflicts"))["conflicts"][0]["key"], "QL-2")
        self.assertEqual(self.start_stored(stored)["state"], "ignored", "a retried invocation starts nothing")

        # The stored review runs through to publishing like an upload review.
        conflicts = self.store.read_json(review.review_key(stored, "conflicts"))["conflicts"]
        lambda_function.lambda_handler({"mode": "review", "batchId": stored, "step": "conflicts",
                                        "decisions": {"choices": {conflicts[0]["id"]: "a"}}, "asOf": "2026-09-01"})
        lambda_function.lambda_handler({"mode": "review", "batchId": stored, "step": "forecast",
                                        "decisions": {"rejectedAll": True}, "asOf": "2026-09-01"})
        lambda_function.lambda_handler({"mode": "review", "batchId": stored, "step": "matching",
                                        "decisions": {"assignment": {}, "decisions": {}}, "asOf": "2026-09-01"})
        latest = self.store.read_json("results/latest.json")
        self.assertEqual((latest["trigger"], latest["batchId"]), ("stored_review", stored))

    def test_review_of_stored_data_waits_for_inputs(self):
        result = self.start_stored("user@example.com/2026-10-21/empty-01")
        self.assertEqual(result["state"], "waiting_for_inputs")
        run = self.store.read_json("results/uploads/user@example.com/2026-10-21/empty-01/status.json")["run"]
        self.assertIn("resource plan", run["message"])

    def test_review_of_stored_data_rejects_odd_batch_ids(self):
        for bad in ("", "../x/2026-10-21/abcdefgh", "user/2026-10-21/short"):
            with self.assertRaises(ValueError):
                self.start_stored(bad)

    def test_upload_without_review_only_saves_the_files(self):
        import lambda_function
        manifest = "raw/user@example.com/2026-10-20/r1/_batch.json"
        self.store.write_bytes(manifest, b'{"review": false}')
        # The manifest's own S3 event comes before any file: it must not end the upload as "all rejected".
        early = lambda_function.lambda_handler(s3_event(manifest))
        self.assertEqual(early["batches"][0]["state"], "waiting_for_files")
        result = self.upload_all()
        self.assertEqual(result["batches"][0]["state"], "saved")
        status = self.status()
        self.assertEqual(status["run"]["state"], "saved")
        self.assertIn("6 files checked and saved", status["run"]["message"])
        self.assertTrue(all(f["status"] == "cleaned" for f in status["files"]), "the manifest is not a data file")
        self.assertTrue(self.store.exists("clean/abcd/latest.json.gz"), "the files became the stored data")
        self.assertFalse(self.store.exists(review.review_key(self.BATCH, "conflicts")), "no review started")
        self.assertFalse(self.store.exists("results/latest.json"), "nothing was published")
        # The saved files can then be reviewed without uploading them again.
        stored = "user@example.com/2026-10-21/stored-02"
        lambda_function.lambda_handler({"mode": "review_start", "batchId": stored, "asOf": "2026-09-01"})
        run = self.store.read_json(f"results/uploads/{stored}/status.json")["run"]
        self.assertEqual((run["state"], run["step"]), ("awaiting_review", "conflicts"))

    def test_going_back_to_the_forecast_redoes_the_matching(self):
        opps = self.run_to_matching()
        before = self.payload("matching")
        pipeline_before = [l for l in before["lines"] if l["source"] == "pipeline"]
        self.assertTrue(pipeline_before, "accepted opportunities add pipeline demand")
        # The user goes back and rejects every opportunity: the matching is redone without pipeline demand.
        result = self.decide("forecast", {"opportunities": {o["id"]: "rejected" for o in opps.values()},
                                          "edits": {}, "removed": [], "redo": True})
        self.assertEqual(result["state"], "awaiting_review")
        run = self.status()["run"]
        self.assertEqual((run["state"], run["step"]), ("awaiting_review", "matching"))
        after = self.payload("matching")
        self.assertEqual([l for l in after["lines"] if l["source"] == "pipeline"], [])
        self.assertEqual(self.store.read_json(f"curated/review/{self.BATCH}/decisions/forecast.json")["opportunities"],
                         {o["id"]: "rejected" for o in opps.values()}, "the new forecast decisions are kept")
        # Conflicts can't be sent again once the review has moved past them.
        self.assertTrue(self.decide("conflicts", {"choices": {}}).get("ignored"))

    def test_forecast_finds_crm_similar_and_manual(self):
        self.upload_all()
        conflicts = self.payload("conflicts")["conflicts"]
        self.decide("conflicts", {"choices": {conflicts[0]["id"]: "a"}})
        self.assertEqual(self.status()["run"]["step"], "forecast")
        opps = {o["crmId"]: o for o in self.payload("forecast")["opportunities"]}
        self.assertNotIn("CRM-4", opps, "Closed Lost is not forecast")
        self.assertEqual(opps["CRM-1"]["source"], "crm")
        self.assertEqual([r["position"] for r in opps["CRM-1"]["resources"]], ["Server Engineer"],
                         "FY suffix removed, Pre Sales row ignored")
        self.assertEqual(opps["CRM-1"]["resources"][0]["fte"], 1.0)
        self.assertEqual(opps["CRM-2"]["source"], "similar")
        self.assertEqual(opps["CRM-2"]["basis"]["projectId"], "PROJ-PAST")
        basis = opps["CRM-2"]["basis"]
        self.assertEqual((basis["durationMonths"], basis["opportunityMonths"]), (6, 5))
        self.assertNotIn("customer", basis["match"], "agency is not a reason for the match")
        self.assertEqual(basis["match"]["tcv"], 0.95)
        self.assertEqual(basis["match"]["offering"], True)
        self.assertGreater(basis["match"]["name"], 0)
        self.assertEqual(set(basis["weights"]), {"tcv", "offering", "duration", "name"})
        self.assertEqual(opps["CRM-2"]["resources"][0]["start"], "2026-11", "moved to the revenue start")
        self.assertEqual(opps["CRM-3"]["source"], "manual")

    def test_full_review_publishes_with_hiring_gap(self):
        self.run_to_matching()
        run = self.status()["run"]
        self.assertEqual(run["step"], "matching")
        page = self.payload("matching")
        sources = {line["source"] for line in page["lines"]}
        self.assertEqual(sources, {"current", "pipeline"})
        current = next(line for line in page["lines"] if line["source"] == "current")
        self.assertIsNotNone(page["assignment"][current["id"]], "the current quote line gets the Sep roll-off")
        self.assertEqual(self.decide("forecast", {})["ignored"], True, "a late message for an old step is ignored")

        decisions = {"decisions": {line["id"]: "accepted" for line in page["lines"]},
                     "assignment": {**page["assignment"],
                                    **{line["id"]: None for line in page["lines"] if line["source"] == "pipeline"}}}
        result = self.decide("matching", decisions)
        self.assertEqual(result["state"], "published")
        self.assertEqual(self.status()["run"]["state"], "published")
        prefix = self.store.read_json("results/latest.json")["prefix"]
        gap = self.store.read_json(prefix + "summary/hiring_gap.json")
        self.assertTrue(gap and all(row["heads"] >= 1 for row in gap))
        self.assertTrue(any(row["from_pipeline"] for row in gap))
        matching = self.store.read_json(prefix + "detail/matching.json")
        self.assertTrue(any(str(r.get("QL | Quote Line Number", "")).startswith(review.PIPELINE_PREFIX)
                            for r in matching), "pipeline demand is part of the published matching")

    def test_rebuilt_availability_matches_the_script_before_any_change(self):
        self.run_to_matching()
        tables = self.store.read_tables(review.work_prefix(self.BATCH) + "matching/")
        from pipeline.config import load
        cfg = load({"asOf": "2026-09-01"})
        rebuilt = review.availability_tables(tables["matching"], cfg.as_of, cfg.window_months, cfg.renewal_rate,
                                             cfg.rp_full_month_mds, cfg.ql_full_month_mds)
        for name in ("availability_forecast", "forecast_6_12m_summary"):
            ours, script = rebuilt[name], tables[name]
            self.assertEqual(list(ours.columns), list(script.columns), name)
            numeric = [c for c in script.columns if c not in ("Month", "Horizon", "Standardized Position", "Window")]
            pd.testing.assert_frame_equal(ours[numeric].reset_index(drop=True).astype(float),
                                          script[numeric].reset_index(drop=True).astype(float),
                                          check_exact=False, atol=0.01, obj=name)

    def test_unfilled_lines_reach_the_published_availability_forecast(self):
        self.run_to_matching()
        page = self.payload("matching")
        matched = [line for line in page["lines"] if page["assignment"].get(line["id"])]
        self.assertTrue(matched, "the fixture has at least one match to undo")
        decisions = {"decisions": {line["id"]: "accepted" for line in page["lines"]},
                     "assignment": {line["id"]: None for line in page["lines"]}}
        self.assertEqual(self.decide("matching", decisions)["state"], "published")
        prefix = self.store.read_json("results/latest.json")["prefix"]
        forecast = pd.DataFrame(self.store.read_json(prefix + "summary/availability_forecast.json"))
        self.assertEqual(int(forecast["Matched Starting"].sum()), 0, "nobody was assigned in the review")
        last = forecast.groupby("Standardized Position").tail(1)
        self.assertTrue((last["Surplus Resources After Matching"] == last["Cumulative Available (plan)"]).all(),
                        "everyone stays available when no line is filled")

    def test_rejected_matching_ends_without_publishing(self):
        self.run_to_matching()
        result = self.decide("matching", {"rejectedAll": True})
        self.assertEqual(result["state"], "ended")
        self.assertEqual(self.status()["run"]["state"], "ended")
        self.assertFalse(self.store.exists("results/latest.json"))


class PieceTests(unittest.TestCase):
    def test_conflict_needs_one_grade_on_each_side(self):
        sl = pd.DataFrame({"Demand Type": ["Quote O3"] * 3, "ID": ["QL-1", "QL-1", "QL-2"],
                           "Position Name": ["DBA", "DBA", "PM"], "Grade": [7, 7, 6], "_row": [2, 3, 4]})
        ql = pd.DataFrame({"Quote Line Number": ["QL-1", "QL-2", "QL-2"], "Position Name": ["DBA", "PM", "PM"],
                           "Grade": [6, 6, 7]})
        found = crossval.find({"sl_rp": {"table": sl}, "quoteline": {"wide": ql}})
        self.assertEqual([c["key"] for c in found], ["QL-1"], "QL-2 has two PMs (bands 6 and 7): two people")
        crossval.apply({"sl_rp": {"table": sl}, "quoteline": {"wide": ql}}, found, {found[0]["id"]: "b"})
        self.assertEqual(set(ql.loc[ql["Quote Line Number"] == "QL-1", "Grade"]), {7})

    def test_a_swap_moves_the_surplus_to_the_other_role(self):
        def person(role, basis="CONFIRMED_END"):
            return {"PRP | Standardized Position": role, "PRP | Available From": "2026-09-15",
                    "PRP | Availability Basis": basis, "PRP | Last MDs": 18.0}
        line = {"QL | Standardized Position": "Developer", "QL | Start Date": "2026-10-01", "QL | Start MDs": 18.5}
        before = pd.DataFrame([{"Match Status": "MATCHED", **person("Developer"), **line},
                               {"Match Status": "UNMATCHED RESOURCE", **person("Tester", "FY_END")}])
        after = pd.DataFrame([{"Match Status": "MATCHED", **person("Tester", "FY_END"), **line},
                              {"Match Status": "UNMATCHED RESOURCE", **person("Developer")}])
        args = ("2026-09-01", 12, 0.8, 18.0, 18.5)
        surplus = {}
        for name, table in (("before", before), ("after", after)):
            f = review.availability_tables(table, *args)["availability_forecast"]
            last = f.groupby("Standardized Position").tail(1).set_index("Standardized Position")
            surplus[name] = last["Surplus Resources After Matching"].to_dict()
            self.assertEqual(int(f["Matched Starting"].sum()), 1)
            oct_dev = f[(f["Standardized Position"] == "Developer") & (f["Month"] == "2026-10-01")]
            self.assertEqual(int(oct_dev["Matched Starting"].iloc[0]), 1, "the line's role and month count it")
        self.assertEqual(surplus["before"], {"Developer": 0, "Tester": 1})
        self.assertEqual(surplus["after"], {"Developer": 1, "Tester": 0})
        summary = review.availability_tables(after, *args)["forecast_6_12m_summary"]
        total = summary[(summary["Window"] == "Next 6 months") & (summary["Standardized Position"] == "ALL ROLES")]
        self.assertEqual(int(total["Surplus Resources After Matching"].iloc[0]), 1)

    def test_availability_needs_the_matching_columns(self):
        self.assertEqual(review.availability_tables(pd.DataFrame({"x": [1]}), "2026-09-01", 12, 0.8, 18, 18.5), {})

    def test_hiring_gap_adds_fte_before_rounding_up(self):
        rows = [{"Match Status": "UNMATCHED PROJECT", "QL | Start Date": "2026-10-01", "QL | Grade": 5,
                 "QL | Standardized Position": "Tester", "QL | Start MDs": mds, "QL | Quote Line Number": "QL-1"}
                for mds in (5.0, 5.0, 4.0)]
        gap = review.hiring_gap(pd.DataFrame(rows), 18.0)
        self.assertEqual(gap.loc[0, "heads"], 1, "three small needs in one band are one person")

    def test_accepted_resources_apply_edits_and_removals(self):
        opps = [{"id": "O-1", "crmId": "C1", "name": "Deal", "resources": [
            {"id": "O-1-r1", "position": "DBA", "grade": 7, "start": "2026-10", "end": "2026-12", "fte": 1.0},
            {"id": "O-1-r2", "position": "PM", "grade": 8, "start": "2026-10", "end": "2026-12", "fte": 0.5}]}]
        kept = review.accepted_resources(opps, {"opportunities": {"O-1": "accepted"},
                                                "edits": {"O-1-r1": {"grade": 6}}, "removed": ["O-1-r2"]})
        self.assertEqual([(r["id"], r["grade"]) for _, r in kept], [("O-1-r1", 6)])
        self.assertEqual(review.accepted_resources(opps, {"rejectedAll": True}), [])

    def test_similarity_threshold_is_respected(self):
        cand = pd.DataFrame({"Project_ID": ["P1"], "TCV_USD": [1000.0], "_duration": [12.0], "_offering": ["crm"],
                             "_service_line": ["crm"], "_tokens": [{"alpha"}]})
        opp = pd.Series({"TCV (converted)": 1_000_000.0, "Revenue From": pd.Timestamp("2026-10-01"),
                         "Revenue To": pd.Timestamp("2026-12-01"), "Major Solution Offering": "ATFM",
                         "Opportunity Name (English)": "beta"})
        self.assertIsNone(opportunities._similar(opp, cand, 0.6))


if __name__ == "__main__":
    unittest.main()
