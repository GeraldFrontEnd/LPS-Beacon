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
        self.assertEqual(v["revenue-per-fte:b9"][apr], 2 * 0.5 * 100 * 20)
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

    def test_dashboard_insights(self):
        self.assertEqual(self.call("GET /dashboard/insights")[0], 204, "not built yet")
        self.objects["results/dashboard/insights.json"] = json.dumps({"pipeline": {"kpis": {"openCount": 3}}}).encode()
        status, body = self.call("GET /dashboard/insights")
        self.assertEqual((status, body["pipeline"]["kpis"]["openCount"]), (200, 3))

    def test_dashboard(self):
        status, body = self.call("GET /dashboard")
        self.assertEqual((status, body["permanent"]["regular"]), (200, 2))
        del self.objects["results/capacity/inputs.json"]
        self.assertEqual(self.call("GET /dashboard")[0], 204)


if __name__ == "__main__":
    unittest.main()
