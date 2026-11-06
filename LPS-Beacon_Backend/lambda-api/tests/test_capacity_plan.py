"""Tests for the capacity plan (capacity_plan.py) and its API routes (GET/PATCH /analysis, DELETE /analysis/edits,
GET /dashboard). Run from lambda-api/:  python -m unittest discover -s tests"""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.dont_write_bytecode = True

import capacity_plan as cp  # noqa: E402
from test_activity import FakeTable  # noqa: E402

RATES = {"b9": 100.0, "b8": 10.0, "b7": 10.0, "b6": 10.0, "b5": 10.0, "b4": 10.0, "b3": 10.0}
TARGETS = {"all": 0.8, **{b: 0.8 for b in cp.BANDS}}


def inputs() -> dict:
    """Two months: Apr'26 actual (UR report), May'26 forecast. Band 9 starts with 2 people, the others empty."""
    return {
        "currency": "USD",
        "months": [{"month": "2026-04", "fiscalYear": "FY26", "actual": True},
                   {"month": "2026-05", "fiscalYear": "FY26", "actual": False}],
        "settings": {"FY26": {"urTargets": TARGETS, "bandDayRatesUsd": RATES, "revenuePerMonthUsd": 8_000_000}},
        "billableUr": {"2026-04": {"all": 0.6, "b9": 0.5}},
        "workingDays": {"2026-04": 20},
        "startingHeadcount": {"month": "2026-04", "bands": {"b9": 2}},
        "headcountBreakdown": {"asOf": "2026-10-22", "permanent": {"regular": 2, "supplementalOther": 0,
                                                                   "supplementalRetiree": 0}, "secondment": 0},
        "notes": [],
    }


class FormulaTests(unittest.TestCase):
    def test_first_month_from_the_uploaded_files(self):
        v = cp.build(inputs(), {})
        apr = "Apr'26"
        self.assertEqual(v["current-hc:b9"][apr], 2)
        self.assertEqual(v["ending-hc:b9"][apr], 2)
        self.assertEqual(v["billable-ur:b9"][apr], 0.5, "actual month: the UR report")
        self.assertEqual(v["billable-hc:b9"][apr], 1)
        self.assertEqual(v["working-days"][apr], 20)
        self.assertNotIn("revenue-per-fte:b9", v, "revenue is not split by band")
        self.assertEqual(v["revenue-per-hc"][apr], (8_000_000) / 2)
        self.assertEqual(v["gp-per-hc"][apr], (8_000_000 - 4000) / 2)
        self.assertAlmostEqual(v["revenue-per-hc-cost"][apr], 8_000_000 / 4000)
        self.assertEqual(v["resource-cost:b9"][apr], 2 * 100 * 20)
        self.assertEqual(v["revenue"][apr], 8_000_000, "the placeholder")
        self.assertEqual(v["gross-margin"][apr], 8_000_000 - 4000)
        self.assertAlmostEqual(v["gross-margin-pct"][apr], (8_000_000 - 4000) / 8_000_000)
        self.assertEqual(v["billable-ur"][apr], 0.6, "total in an actual month: the UR report's all-staff figure")

    def test_forecast_month_uses_targets_weekdays_and_edits(self):
        v = cp.build(inputs(), {"joiners:b9|May'26": 1, "revenue|May'26": 5_000_000})
        may = "May'26"
        self.assertEqual(v["current-hc:b9"][may], 2, "last month's ending HC")
        self.assertEqual(v["ending-hc:b9"][may], 3)
        self.assertEqual(v["billable-ur:b9"][may], 0.8, "forecast month: the target")
        self.assertEqual(v["working-days"][may], 21, "weekdays in May 2026")
        self.assertEqual(v["resource-cost:b9"][may], 3 * 100 * 21)
        self.assertEqual(v["revenue"][may], 5_000_000)
        self.assertAlmostEqual(v["joiners-pct:b9"][may], 1 / 3, msg="joiners / ending HC, as in the template")
        self.assertEqual(v["billable-ur"][may], 0.8, "total in a forecast month: the overall target")

    def test_quarter_and_year_columns(self):
        v = cp.build(inputs(), {"joiners:b9|May'26": 1})
        self.assertEqual(v["current-hc:b9"]["Q1'26"], 2, "opening headcount: the first month's Current HC")
        self.assertEqual(v["ending-hc:b9"]["Q1'26"], 3, "closing headcount: the last month's Ending HC")
        self.assertEqual(v["ending-hc"]["FY'26"], 3, "the year too, and the total row")
        self.assertEqual(v["billable-hc:b9"]["Q1'26"], (1 + 3 * 0.8) / 2, "billable HC stays an average")
        self.assertAlmostEqual(v["joiners-pct:b9"]["Q1'26"], 1 / 2.5, msg="ratios use the average ending HC")
        self.assertEqual(v["joiners:b9"]["Q1'26"], 1, "flows: sum")
        self.assertEqual(v["resource-cost"]["FY'26"], 4000 + 6300)
        self.assertEqual(v["revenue"]["FY'26"], 16_000_000)
        self.assertAlmostEqual(v["billable-ur"]["Q1'26"], (0.6 + 0.8) / 2, msg="total UR: average of the months")
        self.assertAlmostEqual(v["gross-margin-pct"]["FY'26"], (16_000_000 - 10300) / 16_000_000)


class WorkdayAndRevenueTests(unittest.TestCase):
    def test_workday_flows_and_abcd_revenue_are_the_defaults(self):
        data = inputs()
        data["actualFlows"] = {"2026-05": {"joiners": {"b9": 3}, "leavers": {"b9": 1}}}
        data["revenue"] = {"2026-04": {"revenue": 6_500_000, "cost": 4_000_000, "actual": True}}
        data["hiringNeeds"] = {"byMonth": {"2026-05": {"b9": {"heads": 7}}}}
        v = cp.build(data, {})
        self.assertEqual(v["joiners:b9"]["May'26"], 3, "Workday wins over the hiring gap in its months")
        self.assertEqual(v["leavers:b9"]["May'26"], 1)
        self.assertEqual(v["ending-hc:b9"]["May'26"], 4)
        self.assertEqual(v["revenue"]["Apr'26"], 6_500_000, "ABCD revenue")
        self.assertEqual(v["revenue"]["May'26"], 8_000_000, "no ABCD figure: the placeholder")
        v = cp.build(data, {"leavers:b9|May'26": 0})
        self.assertEqual(v["ending-hc:b9"]["May'26"], 5, "a typed value still wins")
        self.assertAlmostEqual(v["revenue-per-hc"]["Q1'26"], (6_500_000 + 8_000_000) / ((2 + 5) / 2), places=1)


class HiringGapTests(unittest.TestCase):
    def test_joiners_default_to_the_hiring_gap(self):
        i = inputs()
        i["hiringNeeds"] = {"runId": "r1", "byMonth": {"2026-05": {"b9": {"heads": 2, "roles": {"Architect": 2}}}}}
        v = cp.build(i, {})
        self.assertEqual(v["joiners:b9"]["May'26"], 2)
        self.assertEqual(v["ending-hc:b9"]["May'26"], 4)
        self.assertEqual(v["joiners"]["May'26"], 2, "the total row adds them up")
        self.assertEqual(cp.build(i, {"joiners:b9|May'26": 0})["joiners:b9"]["May'26"], 0, "a typed 0 overrides")
        self.assertEqual(cp.build(i, {"joiners:b9|May'26": 1})["ending-hc:b9"]["May'26"], 3)


class EditRuleTests(unittest.TestCase):
    def test_input_cells_only(self):
        i = inputs()
        self.assertEqual(cp.check_edit(i, "joiners:b7", "May'26", 3), 3.0)
        self.assertEqual(cp.check_edit(i, "current-hc:b7", "Apr'26", 10), 10.0)
        self.assertIsNone(cp.check_edit(i, "revenue", "May'26", None), "null removes the edit")
        for row, col, value in (("ending-hc:b7", "May'26", 1), ("current-hc:b7", "May'26", 1),
                                ("joiners:b7", "Q1'26", 1), ("joiners", "May'26", 1),
                                ("billable-ur:b7", "May'26", 2), ("working-days", "May'26", 40),
                                ("joiners:b2", "May'26", 1), ("joiners:b7", "May'26", "3"),
                                ("revenue", "May'26", -1)):
            with self.assertRaises(cp.EditError, msg=f"{row} {col} {value!r}"):
                cp.check_edit(i, row, col, value)


ENV = {"DATA_BUCKET": "b", "BUCKET_REGION": "ap-southeast-1", "CHAT_TABLE": "t", "CHAT_MODEL_ID": "m",
       "GUARDRAIL_ID": "g", "GUARDRAIL_VERSION": "1", "AWS_DEFAULT_REGION": "ap-southeast-1"}


class RouteTests(unittest.TestCase):
    """The handlers, with S3 kept in a dict."""

    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import lambda_function
        cls.L = lambda_function

    def setUp(self):
        self.objects = {"results/capacity/inputs.json": json.dumps(inputs()).encode()}
        self.L._read_s3 = lambda key: (self.objects[key], None) if key in self.objects else None
        self.L.s3 = mock.Mock()
        self.L.s3.put_object.side_effect = lambda **kw: self.objects.__setitem__(kw["Key"], kw["Body"])
        self.L.table = FakeTable()   # the activity log (test_activity.py)

    def call(self, route, body=None, user="u1", email="u1@lps.com"):
        event = {"routeKey": route, "body": json.dumps(body) if body is not None else None,
                 "requestContext": {"authorizer": {"jwt": {"claims": {
                     "sub": user, "email": email, "cognito:groups": "[finance_hr]"}}}}}
        r = self.L.lambda_handler(event, None)
        return r["statusCode"], json.loads(r["body"]) if r.get("body") else None

    def test_plan_edit_and_clear_my_edits(self):
        status, plan = self.call("GET /analysis")
        self.assertEqual(status, 200)
        self.assertEqual(plan["values"]["revenue"]["Apr'26"], 8_000_000)
        self.assertEqual([m["actual"] for m in plan["months"]], [True, False])

        status, plan = self.call("PATCH /analysis", {"rowId": "revenue", "columnKey": "May'26", "value": 7_500_000})
        self.assertEqual((status, plan["values"]["revenue"]["May'26"]), (200, 7_500_000))
        self.assertEqual(plan["edited"]["revenue|May'26"]["mine"], True)
        self.call("PATCH /analysis", {"rowId": "joiners:b9", "columnKey": "May'26", "value": 1}, user="u2",
                  email="u2@lps.com")

        status, plan = self.call("GET /analysis", user="u2", email="u2@lps.com")
        self.assertEqual(plan["edited"]["revenue|May'26"], {"mine": False, "byName": "u1@lps.com",
                                                             "at": plan["edited"]["revenue|May'26"]["at"]},
                         "edits are shared, with who made them")

        status, plan = self.call("DELETE /analysis/edits")
        self.assertEqual((status, plan["cleared"]), (200, 1))
        self.assertEqual(plan["values"]["revenue"]["May'26"], 8_000_000, "u1's edit is gone")
        self.assertEqual(plan["values"]["ending-hc:b9"]["May'26"], 3, "u2's edit stays")

        status, plan = self.call("PATCH /analysis", {"rowId": "joiners:b9", "columnKey": "May'26", "value": None})
        self.assertEqual(plan["values"]["ending-hc:b9"]["May'26"], 2, "null puts the cell back")

    def test_refused_edits(self):
        self.assertEqual(self.call("PATCH /analysis", {"rowId": "ending-hc:b9", "columnKey": "May'26",
                                                       "value": 1})[0], 400)
        self.assertEqual(self.call("PATCH /analysis", {"rowId": "x;drop", "columnKey": "May'26", "value": 1})[0], 400)
        del self.objects["results/capacity/inputs.json"]
        self.assertEqual(self.call("PATCH /analysis", {"rowId": "revenue", "columnKey": "May'26", "value": 1})[0], 409)
        status, plan = self.call("GET /analysis")
        self.assertEqual((status, plan["values"]), (200, {}), "no plan yet: empty, with a note")

    def test_management_target_lines_are_shared_and_costs_kept_negative(self):
        status, plan = self.call("PATCH /analysis", {"target": {"fiscalYear": "FY26", "period": "FY", "column": "mt",
                                                                "rowId": "revenue", "value": 1_000_000}})
        self.assertEqual((status, plan["managementTarget"]["FY26|FY|mt|revenue"]["value"]), (200, 1_000_000))
        self.call("PATCH /analysis", {"target": {"fiscalYear": "FY26", "period": "Q2", "column": "mt",
                                                 "rowId": "opex", "value": 50}}, user="u2", email="u2@lps.com")
        status, plan = self.call("GET /analysis")
        cell = plan["managementTarget"]["FY26|Q2|mt|opex"]
        self.assertEqual((cell["value"], cell["mine"], cell["byName"]), (-50, False, "u2@lps.com"), "a cost is negative")
        status, plan = self.call("PATCH /analysis", {"target": {"fiscalYear": "FY26", "period": "Q3", "column": "mt",
                                                                "rowId": "gp-pct", "value": 0.24}})
        self.assertEqual(plan["managementTarget"]["FY26|Q3|mt|gp-pct"]["value"], 0.24, "MT lines are all typed in")
        status, plan = self.call("PATCH /analysis", {"target": {"fiscalYear": "FY26", "period": "FY", "column": "mt",
                                                                "rowId": "revenue", "value": None}})
        self.assertNotIn("FY26|FY|mt|revenue", plan["managementTarget"])
        for bad in ({"fiscalYear": "2026", "period": "FY", "column": "mt", "rowId": "revenue", "value": 1},
                    {"fiscalYear": "FY26", "period": "Q5", "column": "mt", "rowId": "revenue", "value": 1},
                    {"fiscalYear": "FY26", "period": "FY", "column": "current", "rowId": "gp", "value": 1},
                    {"fiscalYear": "FY26", "period": "FY", "column": "mt", "rowId": "revenue", "value": "x"}):
            self.assertEqual(self.call("PATCH /analysis", {"target": bad})[0], 400, bad)

    def test_dashboard_insights(self):
        self.assertEqual(self.call("GET /dashboard/insights")[0], 204, "not built yet")
        self.objects["results/dashboard/insights.json"] = json.dumps({"pipeline": {"kpis": {"openCount": 3}}}).encode()
        status, body = self.call("GET /dashboard/insights")
        self.assertEqual((status, body["pipeline"]["kpis"]["openCount"]), (200, 3))

    def test_dashboard(self):
        status, body = self.call("GET /dashboard")
        self.assertEqual((status, body["permanent"]["regular"]), (200, 2))
        self.assertIsNone(body["selection"], "no filter: the page uses the organisation's figures")
        self.assertEqual(body["filters"], {"agencies": [], "projects": []})

    def test_dashboard_filtered_by_agency_or_project(self):
        import lambda_function as L
        data = inputs()
        cell = {"fte": 3.5, "people": 4, "permanent": 3, "secondment": 1, "other": 0, "unknown": 0,
                "billable": 60, "workingDays": 80}
        data["breakdown"] = {"agencies": {"Agency X": {"projects": ["P1"], "byMonth": {"2026-04": cell}}},
                             "projects": {"P1": {"name": "Proj One", "agency": "Agency X", "byMonth": {"2026-04": cell}}}}
        view = L.dashboard_view(data, agency="Agency X")
        self.assertEqual(view["filters"]["agencies"], ["Agency X"])
        self.assertEqual(view["filters"]["projects"], [{"id": "P1", "name": "Proj One", "agency": "Agency X"}])
        self.assertEqual((view["selection"]["kind"], view["selection"]["byMonth"]["2026-04"]["people"]), ("agency", 4))
        view = L.dashboard_view(data, project_id="P1")
        self.assertEqual((view["selection"]["kind"], view["selection"]["agency"]), ("project", "Agency X"))
        with self.assertRaises(L.HttpError):
            L.dashboard_view(data, agency="Nobody")

    def test_dashboard_lists_the_people_of_the_selection(self):
        import lambda_function as L
        data = inputs()
        cell = {"fte": 1, "people": 2, "permanent": 2, "secondment": 0, "other": 0, "unknown": 0, "billable": 0,
                "workingDays": 0}
        data["breakdown"] = {"agencies": {"Agency X": {"projects": ["P1", "P2"], "byMonth": {"2026-10": cell}}},
                             "projects": {"P1": {"name": "One", "agency": "Agency X", "byMonth": {}},
                                          "P2": {"name": "Two", "agency": "Agency X", "byMonth": {}}}}
        person = lambda name, days: {"name": name, "position": "DBA", "band": 7, "employment": "permanent",  # noqa: E731
                                     "planDays": 18, "planFte": 1, "actualDays": days, "actualFte": days / 18,
                                     "clockedDaysAllProjects": days, "split": False}
        roster = {"actualMonths": ["2026-09", "2026-10"], "actualSource": "mspo", "projects": {
            "P1": {"name": "One", "byMonth": {"2026-10": {"people": [person("Zed", 19)]},
                                              "2026-09": {"people": [person("Old", 18)]}}},
            "P2": {"name": "Two", "byMonth": {"2026-10": {"people": [person("Amy", 14)]}}}}}
        view = L.dashboard_view(data, agency="Agency X", roster=roster)
        self.assertEqual(view["people"]["month"], "2026-10", "latest clocked month by default")
        self.assertEqual([(r["name"], r["projectId"]) for r in view["people"]["rows"]], [("Amy", "P2"), ("Zed", "P1")])
        view = L.dashboard_view(data, project_id="P1", roster=roster, month="2026-09")
        self.assertEqual([r["name"] for r in view["people"]["rows"]], ["Old"])
        self.assertNotIn("people", L.dashboard_view(data, roster=roster), "no selection, no list")
        self.objects["results/capacity/inputs.json"] = json.dumps(data).encode()
        self.objects["results/capacity/roster.json"] = json.dumps(roster).encode()
        L._results_cache.clear()
        status, body = self.call("GET /dashboard", None)
        self.assertEqual(status, 200)

    def test_dashboard_headcount_details_by_agency(self):
        import lambda_function as L
        person = lambda name, plan, days, pos="DBA": {"name": name, "position": pos, "band": 7,  # noqa: E731
                                                     "employment": "permanent", "planDays": plan, "planFte": plan / 18,
                                                     "actualDays": days, "actualFte": days / 18,
                                                     "clockedDaysAllProjects": 18, "split": False}
        roster = {"actualMonths": ["2026-10"], "fullMonthManDays": 18, "actualSource": "mspo", "projects": {
            "P1": {"name": "One", "agency": "Agency X", "byMonth": {"2026-10": {
                "headcount": 2, "planDays": 36, "actualDays": 27, "people": [person("Zed", 18, 18), person("Amy", 18, 9)]}}},
            "P2": {"name": "Two", "agency": "Agency X", "byMonth": {"2026-10": {
                "headcount": 1, "planDays": 9, "actualDays": 9, "people": [person("Amy", 9, 9)]}}},
            "P3": {"name": "Three", "agency": "Agency Y", "byMonth": {
                "2026-10": {"headcount": 1, "planDays": 18, "actualDays": 18, "people": [person("Bob", 18, 18, "PM")]},
                "2026-11": {"headcount": 1, "planDays": 18, "actualDays": None, "people": [person("Bob", 18, 0, "PM")]}}}}}
        sold = {"fullMonthManDays": 18, "byProject": {"P1": {"2026-10": 54}, "P3": {"2026-10": 18}}}
        out = L.agency_panels(roster, sold=sold)
        self.assertEqual(out["month"], "2026-10")
        self.assertEqual([a["agency"] for a in out["agencies"]], ["Agency X", "Agency Y"], "largest actual first")
        x = out["agencies"][0]
        self.assertEqual((x["planFte"], x["actualFte"], x["headcount"], x["asSoldFte"]), (2.5, 2.0, 2, 3.0))
        self.assertEqual([p["asSoldFte"] for p in x["projects"]], [3.0, None], "P2 has no quote line")
        self.assertNotIn("people", x["projects"][0], "the Dashboard summary carries no people")
        with_people = L.agency_panels(roster, {"Agency X": ["P1"]}, sold=sold, with_people=True)
        amy = next(r for r in with_people["agencies"][0]["projects"][0]["people"] if r["name"] == "Amy")
        self.assertEqual((amy["planFte"], amy["actualFte"], amy["skill"], amy["salaryScale"]), (1.0, 0.5, "DBA", None))
        fc = L.agency_panels(roster, {"Agency Y": ["P3"]}, "2026-11")
        self.assertFalse(fc["clocked"])
        self.assertEqual((fc["agencies"][0]["planFte"], fc["agencies"][0]["actualFte"]), (1.0, None), "forecast: plan only")
        data = inputs()
        data["asSold"] = sold
        cell = {"fte": 2.5, "people": 2, "permanent": 2, "secondment": 0, "other": 0, "unknown": 0, "billable": 0,
                "workingDays": 0}
        data["breakdown"] = {"agencies": {"Agency X": {"projects": ["P1", "P2"], "byMonth": {"2026-10": cell}}},
                             "projects": {"P1": {"name": "One", "agency": "Agency X", "byMonth": {"2026-10": cell}}}}
        view = L.dashboard_view(data, agency="Agency X", roster=roster)
        self.assertEqual([a["agency"] for a in view["agencyPanels"]["agencies"]], ["Agency X"])
        self.assertEqual(view["selection"]["byMonth"]["2026-10"]["soldFte"], 3.0)
        self.assertNotIn("soldFte", data["breakdown"]["agencies"]["Agency X"]["byMonth"]["2026-10"], "inputs untouched")
        view = L.dashboard_view(data, project_id="P1", roster=roster, with_people=True)
        self.assertEqual([p["projectId"] for p in view["agencyPanels"]["agencies"][0]["projects"]], ["P1"])
        self.assertIn("people", view["agencyPanels"]["agencies"][0]["projects"][0])
        self.assertEqual(len(L.dashboard_view(data, roster=roster)["agencyPanels"]["agencies"]), 2)
        self.assertEqual(L._sold_fte_by_month({"fullMonthManDays": 18, "byMonth": {"2026-10": 36}}), {"2026-10": 2.0})
        over = L.agency_panels(roster, {"Agency Y": ["P3"]}, "2026-11", with_people=True, people_months=["2026-10", "2026-11"])
        bob = over["agencies"][0]["projects"][0]["people"][0]
        self.assertEqual((bob["planFte"], bob["actualFte"], bob["clockedDaysAllProjects"]), (1.0, 0.5, 18.0),
                         "averaged a month over the months given")

    def test_dashboard_204_without_inputs(self):
        del self.objects["results/capacity/inputs.json"]
        self.assertEqual(self.call("GET /dashboard")[0], 204)


if __name__ == "__main__":
    unittest.main()
