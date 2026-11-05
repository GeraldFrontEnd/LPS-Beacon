"""Tests for the chat's analytics tools (analytics_tools.py) and who may use them (lambda_function.TOOLS_BY_GROUP).
Run from lambda-api/:  python -m unittest discover -s tests"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.dont_write_bytecode = True

import analytics_tools as at  # noqa: E402
import capacity_plan as cp  # noqa: E402
from test_capacity_plan import ENV, inputs as plan_inputs  # noqa: E402

RATES = {"b9": 100.0, "b8": 10.0, "b7": 10.0, "b6": 10.0, "b5": 10.0, "b4": 10.0, "b3": 10.0}


def data():
    """Two plan months (Apr'26 actual), band 9 has 2 people at $100 a day, revenue $8M a month."""
    i = plan_inputs()
    i["settings"]["FY26"]["target"] = {"revenueUsd": 90_000_000, "gpPct": 0.27, "billableUr": 0.854,
                                       "manDaysPerFte": 18, "manDaysAreBillable": True}
    i["demand"] = {"2026-04": {"fte": 3.0, "project": 3.0, "quoteWon": 0.0}}
    i["productivity"] = {
        "fiscalYear": "FY26", "months": ["2026-04"],
        "companyAverage": {"revenuePerFte": 120_000, "gpPerFte": 30_000, "revenuePerHcCost": 1.4},
        "rules": {"draft": True, "metrics": ["revenuePerFte"], "minFte": 1,
                  "productivity": {"redBelowPct": 0.2, "amberBelowPct": 0.05},
                  "staffing": {"redOffPct": 0.3, "amberOffPct": 0.15}},
        "agencies": [
            {"agency": "Agency Red", "revenue": 50_000, "fte": 10, "revenuePerFte": 60_000, "gpPerFte": 1_000,
             "revenuePerHcCost": 0.9, "requiredFte": 5.0, "ratePerDay": 300, "flag": "red", "staffing": "over",
             "flagReason": "Revenue per FTE 50% below the company average",
             "projects": [{"projectId": "P-1", "projectName": "Helpdesk", "revenue": 50_000, "fte": 10,
                           "revenuePerFte": 60_000, "gpPerFte": 1_000, "revenuePerHcCost": 0.9, "requiredFte": 5.0,
                           "flag": "red", "staffing": "over", "flagReason": "below"}]},
            {"agency": "Agency Green", "revenue": 200_000, "fte": 15, "revenuePerFte": 160_000, "gpPerFte": 60_000,
             "revenuePerHcCost": 2.0, "requiredFte": 15.0, "ratePerDay": 400, "flag": "green", "staffing": "on target",
             "flagReason": "at or above the company average", "projects": []},
        ]}
    i["breakdown"] = {
        "agencies": {"Agency Red": {"projects": ["P-1"], "byMonth": {"2026-04": {
            "fte": 9.5, "people": 11, "permanent": 8, "secondment": 2, "other": 0, "unknown": 1,
            "billable": 150.0, "workingDays": 200.0}}}},
        "projects": {"P-1": {"name": "Helpdesk", "agency": "Agency Red", "byMonth": {}}}}
    return i


def insights():
    def person(name, position, level, band, when, fy, q, redeployed=None):
        return {"resource": name, "position": position, "level": level, "band": band, "availableFrom": when,
                "fiscalYear": fy, "quarter": q, "status": None, "currentProject": "Old", "currentCustomer": "Agency",
                "redeployedTo": redeployed, "redeployedStart": None}
    return {"resources": {"availability": [
        person("Ann", "Cloud DBA L2", "L2", 7, "2026-12-01", "FY26", "Q3"),
        person("Ben", "Cloud DBA L2", "L2", 6, "2026-11-01", "FY26", "Q3"),
        person("Cy", "Cloud DBA L2", "L2", 7, "2027-02-01", "FY26", "Q4", redeployed="New project"),
        person("Di", "Network Engineer L1", "L1", 5, "2027-04-01", "FY27", "Q1"),
    ]}}


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.inputs = data()
        self.values = cp.build(self.inputs, {})

    def test_baseline_matches_the_capacity_plan(self):
        b = at.baseline(self.inputs, self.values)
        # Apr: revenue $8M, 2 HC, cost 2 x $100 x 20 days = $4,000; one month annualised x 12.
        self.assertEqual(b["revenuePerHcUsd"], round(8_000_000 * 12 / 2))
        self.assertEqual(b["gpPerHcUsd"], round((8_000_000 - 4000) * 12 / 2))
        self.assertEqual(b["revenuePerDollarOfHcCost"], 2000.0)
        self.assertEqual(b["weightedCostPerFtePerDayUsd"], 100)

    def test_fte_calculator_both_ways_on_adr(self):
        r = at.fte_required(self.inputs, self.values, {"billableUr": 87})
        adr = 250_000 / (25 * 18)                     # both agencies: revenue / (FTE x 18 x 1 month)
        self.assertEqual(r["adrUsdPerDay"], round(adr))
        per_fte = adr * 18 * 12
        self.assertAlmostEqual(r["totalFteRequired"], round(90_000_000 / per_fte / 0.87, 1))
        self.assertEqual(len(r["formulaSteps"]), 4)
        back = at.fte_required(self.inputs, self.values, {"fte": r["totalFteRequired"], "billableUr": 0.87})
        self.assertEqual(back["mode"], "revenue from FTE")
        self.assertAlmostEqual(back["revenueUsd"] / 90_000_000, 1, places=3)
        agency = at.fte_required(self.inputs, self.values, {"agency": "agency red"})
        self.assertEqual((agency["scope"], agency["adrUsdPerDay"]), ("Agency Red", round(50_000 / 180)))
        self.assertIn("error", at.fte_required(self.inputs, self.values, {"agency": "Nobody"}))

    def test_productivity_filters(self):
        rows = at.productivity(self.inputs, self.values, {"belowAverageOnly": True})["rows"]
        self.assertEqual([r["agency"] for r in rows], ["Agency Red"])
        projects = at.productivity(self.inputs, self.values, {"level": "project", "name": "P-1"})["rows"]
        self.assertEqual(projects[0]["agency"], "Agency Red")
        self.assertTrue(at.productivity(self.inputs, self.values, {})["flagRules"]["draft"])

    def test_hiring_what_if(self):
        r = at.hiring_what_if(self.inputs, self.values, {"agency": "Agency Red", "hires": 2})
        self.assertEqual(r["revenuePerFTENowUsd"], 60_000)
        self.assertEqual(r["revenuePerFTEIfNotBillableUsd"], 50_000)
        self.assertGreater(r["revenuePerFTEIfBillableUsd"], r["revenuePerFTEIfNotBillableUsd"])
        r0 = at.hiring_what_if(self.inputs, self.values, {"hires": 0})
        self.assertEqual(r0["revenuePerHCNowUsd"], r0["revenuePerHCIfBillableUsd"], "no hires: nothing changes")

    def test_redeployable_soonest_first_and_names_only_for_finance(self):
        today = dt.date(2026, 11, 3)
        r = at.redeployable(insights(), {"position": "cloud dba l2"}, today)
        self.assertEqual([x["person"] for x in r["rows"]], ["Ben", "Ann"], "Cy is already redeployed")
        self.assertEqual((r["freeNow"], r["freeWithin1Month"]), (1, 2))
        hidden = at.redeployable(insights(), {"position": "cloud dba l2"}, today, with_names=False)
        self.assertNotIn("rows", hidden)
        self.assertEqual(hidden["total"], 2)

    def test_bench_by_quarter(self):
        r = at.bench_by_quarter(insights(), {"fiscalYear": "FY'26", "includeRedeployed": True})
        self.assertEqual(r["totals"], {"Q1": 0, "Q2": 0, "Q3": 2, "Q4": 1})
        self.assertEqual(at.bench_by_quarter(insights(), {"fiscalYear": "FY27", "level": "L1"})["totals"]["Q1"], 1)

    def test_headcount_today(self):
        org = at.headcount_today(self.inputs, self.values, {})
        self.assertEqual((org["headcount"], org["fteDemand"], org["benchOrShortageFte"]), (2, 3.0, -1))
        agency = at.headcount_today(self.inputs, self.values, {"agency": "red"})
        self.assertEqual((agency["peoplePlanned"], agency["permanent"], agency["billableUr"]), (11, 8, 0.75))


def roster():
    def person(name, plan, clocked, actual, split=False):
        return {"name": name, "position": "Cloud DBA L2", "band": 7, "employment": "permanent", "planDays": plan,
                "planFte": round(plan / 18, 2), "clockedDaysAllProjects": clocked, "actualDays": actual,
                "actualFte": None if actual is None else round(actual / 18, 2), "split": split}
    return {"projects": {
        "P-1": {"name": "Helpdesk", "agency": "Agency Red", "byMonth": {
            "2026-09": {"actual": True, "headcount": 1, "planDays": 18, "planFte": 1, "actualDays": 19, "actualFte": 1.06,
                        "daysPerHead": 19, "notClocked": 0, "people": [person("Ann", 18, 19, 19)]},
            "2026-10": {"actual": True, "headcount": 2, "planDays": 27, "planFte": 1.5, "actualDays": 25, "actualFte": 1.39,
                        "daysPerHead": 16, "notClocked": 0,
                        "people": [person("Ben", 9, 14, 7, split=True), person("Ann", 18, 18, 18)]},
            "2026-11": {"actual": False, "headcount": 1, "planDays": 18, "planFte": 1, "actualDays": None,
                        "actualFte": None, "daysPerHead": None, "notClocked": None, "people": [person("Ann", 18, None, None)]},
        }},
        "P-2": {"name": "Help line", "agency": "Agency Red", "byMonth": {}},
    }}


class ProjectResourcesTests(unittest.TestCase):
    def test_latest_clocked_month_with_names_plan_and_actual(self):
        r = at.project_resources(roster(), {"project": "P-1"})
        self.assertEqual((r["project"], r["month"], r["monthHasClocking"]), ("P-1", "2026-10", True))
        self.assertEqual([p["name"] for p in r["people"]], ["Ann", "Ben"], "most plan days first")
        self.assertEqual((r["people"][1]["actualDays"], r["people"][1]["split"]), (7, True))
        self.assertEqual(r["yearToDate"], {"months": 2, "planDays": 45, "actualDays": 44})
        self.assertEqual([m["month"] for m in r["byMonth"]], ["2026-09", "2026-10", "2026-11"])

    def test_a_forecast_month_is_plan_only(self):
        r = at.project_resources(roster(), {"project": "helpdesk", "month": "2026-11"})
        self.assertEqual((r["monthHasClocking"], r["thisMonth"]["actualFte"]), (False, None))

    def test_ambiguous_missing_and_names_hidden(self):
        self.assertIn("matches", at.project_resources(roster(), {"project": "help"}))
        self.assertIn("error", at.project_resources(roster(), {"project": "nothing"}))
        self.assertIn("monthsWithPeople", at.project_resources(roster(), {"project": "P-1", "month": "2025-01"}))
        hidden = at.project_resources(roster(), {"project": "P-1"}, with_names=False)
        self.assertEqual([p["name"] for p in hidden["people"]], ["Person 1", "Person 2"])
        self.assertIn("namesHidden", hidden)


class PermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import lambda_function
        cls.L = lambda_function

    def test_restricted_users_get_no_cost_tools_or_names(self):
        restricted = self.L.TOOLS_BY_GROUP[self.L.RESTRICTED]
        for name in ("get_productivity_metrics", "calculate_fte_required", "hiring_what_if", "find_available_resources"):
            self.assertNotIn(name, restricted)
            self.assertIn(name, self.L.TOOLS_BY_GROUP[self.L.FINANCE_HR])
        self.assertTrue(set(self.L.TOOLS_BY_GROUP[self.L.FINANCE_HR]) <= set(self.L.TOOLS))

    def test_redeployable_hides_names_from_restricted_callers(self):
        self.L._read_s3 = lambda key: (json.dumps(insights()).encode(), None) if key == self.L.INSIGHTS_KEY else None
        self.L._results_cache.clear()
        caller = mock.Mock(is_finance_hr=False, groups={self.L.RESTRICTED})
        result = self.L.run_tool(caller, {"name": "find_redeployable_people", "toolUseId": "t1",
                                          "input": {"position": "Cloud DBA"}})
        payload = result["toolResult"]["content"][0]["json"]
        self.assertNotIn("rows", payload)
        caller = mock.Mock(is_finance_hr=True, groups={self.L.FINANCE_HR})
        result = self.L.run_tool(caller, {"name": "find_redeployable_people", "toolUseId": "t2",
                                          "input": {"position": "Cloud DBA"}})
        self.assertIn("rows", result["toolResult"]["content"][0]["json"])


if __name__ == "__main__":
    unittest.main()
