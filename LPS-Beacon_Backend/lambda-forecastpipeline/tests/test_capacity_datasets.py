"""Tests for the capacity-plan inputs the pipeline cleans: the BU UR report and the MSPO staff list
(pipeline/clean.py: clean_bu_ur, clean_staff_list). Both mimic the real exports' layout."""
from __future__ import annotations

import datetime as dt
import io
import sys
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_pipeline import Base, s3_event  # noqa: E402

import pandas as pd  # noqa: E402

from pipeline import capacity, clean, clocking, insights, plan_settings  # noqa: E402
from test_review import sfdc_xlsx  # noqa: E402

UR_HEADER = ["BU UR Tgt", "Tier & Grade", "Grade Group", "Grade", "Report Month", "Staff Name", "IT Code", "Tier",
             "Billable", "Internal", "Presales", "Admin", "Bench", "Training", "Missing Manday", "Leave",
             "Billable Adj", "Productive Adj", "Submitted Manday", "Standard Working days (Current month)",
             "Billable UR"]


def ur_xlsx() -> bytes:
    """Like the real report: subtotals in row 1 (numbers in I, T and U), the header in row 2, #REF! lookups."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Export"
    ws.append([None] * 8 + [40.0] + [None] * 10 + [62, 0.645])
    ws.append(UR_HEADER)
    rows = [  # grade, month, name, IT code, billable, working days
        (3, dt.datetime(2026, 4, 15), "Person A", "a1", 18, 21),
        (3, dt.datetime(2026, 4, 15), "Person B", "b1", 21, 21),
        (7, dt.datetime(2026, 4, 15), "Person C", "c1", 10, 21),
        (None, dt.datetime(2026, 4, 15), "Person D", "d1", 0, 21),   # grade lookup broken
        (3, dt.datetime(2026, 5, 15), "Person A", "a1", 19, 19),
    ]
    for grade, month, name, code, billable, days in rows:
        ws.append(["#REF!", f"Tier B - {grade}", "#REF!", grade, month, name, code, "Tier B", billable,
                   0, 0, 0, 0, 0, 0, 0, 0, 0, billable, days, billable / days])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def staff_xlsx() -> bytes:
    """Like the Dynamics export: an empty first row, the header on row 2, and a hidden metadata sheet."""
    wb = Workbook()
    ws = wb.active
    ws.title = "MSPO SG Staff List"
    ws.append([])
    ws.append(["Name", "IT Code", "Grade", "Join Date", "Last Employment Date", "Cost Center Code",
               "Working City", "Employee Type", "Billable Status", "CCC Billable Status​"])
    people = [("Employee-A", "a1", "3", "Regular Employee"), ("Employee-B", "b1", "3", "Secondment"),
              ("Employee-C", "c1", "7", "Supplemental-Other"), ("Employee-E", "e1", "", "Regular Employee")]
    for name, code, grade, kind in people:
        ws.append([name, code, grade, dt.datetime(2024, 1, 1), None, "SG14000012", "SG - Singapore", kind,
                   "Tier B", "Billable"])
    hidden = wb.create_sheet("hiddenSheet")
    hidden.append(["bookableresource:abc==:name=Name&lvo_itcode=IT%20Code", None])
    hidden.append(["Regular Employee", "Secondment"])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def workday_xlsx(month_end: dt.datetime, rows: list[tuple], grade: bool = False) -> bytes:
    """Like the Workday new hire / leaver report: two title rows, then the header (plus the synthetic files' Grade)."""
    wb = Workbook()
    ws = wb.active
    ws.append(["Termination Date is greater than or equal to", month_end.replace(day=1)])
    ws.append(["Effective as of Date", month_end])
    ws.append(["Employee ID", "Worker", "Original Hire Date", "Termination Date"] + (["Grade"] if grade else []))
    for row in rows:
        ws.append(list(row))
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


class WorkdayTests(Base):
    MAY = dt.datetime(2026, 5, 31)

    def may(self) -> bytes:
        return workday_xlsx(self.MAY, [
            ("ID 1", "Person A", dt.datetime(2021, 3, 1), dt.datetime(2026, 5, 20)),     # leaver, band 3 on the UR report
            ("ID 9", "New Person", dt.datetime(2026, 5, 4), None),                      # joiner, not on any file yet
            ("ID 3", "person  c", dt.datetime(2026, 5, 11), None),                      # joiner, Person C (band 7)
        ])

    def test_detected_and_names_dropped(self):
        dataset, sheets = clean.detect(clean.read_any(self.may(), ".xlsx"), "SG_Delivery_New_Hire_Leaver.xlsx")
        self.assertEqual(dataset, "workday_hire_leaver")
        table, warnings = clean.clean_workday(sheets["main"], sheets["title"])
        self.assertEqual(list(table["Kind"]), ["leaver", "joiner", "joiner"])
        self.assertEqual(set(table["Month"]), {"2026-05"})
        self.assertNotIn("Worker", table.columns)
        self.assertFalse(table.astype(str).apply(lambda c: c.str.contains("Person")).any().any())

    def test_a_grade_column_is_used_instead_of_the_name_lookup(self):
        import lambda_function
        for name, data in (("BU_UR.xlsx", ur_xlsx()),
                           ("Hire_Leaver_May.xlsx", workday_xlsx(self.MAY, [
                               ("ID 1", "Person A", dt.datetime(2021, 3, 1), dt.datetime(2026, 5, 20), 8),  # UR says 3
                               ("ID 9", "New Person", dt.datetime(2026, 5, 4), None, 5)], grade=True))):
            lambda_function.lambda_handler(s3_event(self.put(name, data)))
        flows = self.store.read_json(capacity.KEY)["actualFlows"]["2026-05"]
        self.assertEqual((flows["leavers"], flows["joiners"]), ({"b8": 1}, {"b5": 1}))
        self.assertEqual(flows["unbanded"], {"joiners": 0, "leavers": 0})

    def test_months_add_up_and_bands_come_from_the_ur_report(self):
        import lambda_function
        for name, data in (("BU_UR.xlsx", ur_xlsx()), ("MSPO SG Staff List.xlsx", staff_xlsx()),
                           ("Hire_Leaver_May.xlsx", self.may()),
                           ("Hire_Leaver_Apr.xlsx", workday_xlsx(dt.datetime(2026, 4, 30), [
                               ("ID 2", "Person B", dt.datetime(2026, 4, 6), None)]))):
            lambda_function.lambda_handler(s3_event(self.put(name, data)))
        inputs = self.store.read_json(capacity.KEY)
        flows = inputs["actualFlows"]
        self.assertEqual(sorted(flows), ["2026-04", "2026-05"], "each upload adds its month")
        self.assertEqual(flows["2026-04"]["joiners"], {"b3": 1})
        self.assertEqual(flows["2026-05"]["leavers"], {"b3": 1}, "Person A is band 3 on the UR report")
        self.assertEqual(sum(flows["2026-05"]["joiners"].values()), 2)
        self.assertEqual(flows["2026-05"]["joiners"].get("b7", 0) >= 1, True, "Person C found despite the spacing")
        self.assertEqual(flows["2026-05"]["unbanded"]["joiners"], 1, "New Person is spread over the bands")
        # Uploading May again replaces May only.
        import lambda_function as lf
        lf.lambda_handler(s3_event(self.put("Hire_Leaver_May_v2.xlsx", workday_xlsx(self.MAY, []))))
        flows = self.store.read_json(capacity.KEY)["actualFlows"]
        self.assertEqual(sorted(flows), ["2026-04"])


class UrReportTests(Base):
    def test_detected_below_the_subtotal_row(self):
        dataset, sheets = clean.detect(clean.read_any(ur_xlsx(), ".xlsx"), "BU_UR.xlsx")
        self.assertEqual(dataset, "bu_ur")
        self.assertIn("Report Month", sheets["main"].columns)

    def test_billable_ur_per_month_and_band(self):
        _, sheets = clean.detect(clean.read_any(ur_xlsx(), ".xlsx"))
        tables, warnings = clean.clean_bu_ur(sheets["main"])
        self.assertNotIn("Staff Name", tables["latest"].columns, "names are dropped")
        m = tables["monthly"]
        overall = m[m["Band"].isna()].set_index("Month")["billableUr"]
        self.assertAlmostEqual(overall["2026-04"], 49 / 84, "all staff, including the row with no grade")
        self.assertAlmostEqual(overall["2026-05"], 1.0)
        band = m.dropna(subset=["Band"]).set_index(["Month", "Band"])["billableUr"]
        self.assertAlmostEqual(band[("2026-04", 3)], 39 / 42)
        self.assertAlmostEqual(band[("2026-04", 7)], 10 / 21)
        self.assertEqual(len(band), 3, "the row without a grade is in no band")
        self.assertEqual(tables["working_days"].set_index("Month")["standardWorkingDays"].to_dict(),
                         {"2026-04": 21, "2026-05": 19})
        self.assertTrue(any("1 rows have no grade" in w for w in warnings))

    def test_upload_stores_it(self):
        import lambda_function
        key = self.put("BU_UR.xlsx", ur_xlsx())
        result = lambda_function.lambda_handler(s3_event(key))
        self.assertEqual(result["files"][0]["dataset"], "bu_ur")
        self.assertTrue(self.store.exists("clean/bu_ur/monthly.json.gz"))
        self.assertTrue(self.store.exists("clean/bu_ur/latest.quality.json"))


class StaffListTests(Base):
    def test_headcount_by_band_and_type(self):
        dataset, sheets = clean.detect(clean.read_any(staff_xlsx(), ".xlsx"), "MSPO SG Staff List.xlsx")
        self.assertEqual(dataset, "staff_list")
        tables, warnings = clean.clean_staff_list(sheets["main"])
        self.assertNotIn("Name", tables["latest"].columns, "names are dropped")
        self.assertIn("CCC Billable Status", tables["latest"].columns, "zero-width space removed from the heading")
        self.assertEqual(tables["headcount_by_band"].set_index("Band")["headcount"].to_dict(), {3: 2, 7: 1})
        self.assertEqual(tables["headcount_by_type"].set_index("Employee Type")["headcount"].to_dict(),
                         {"Regular Employee": 2, "Secondment": 1, "Supplemental-Other": 1})
        self.assertTrue(any("1 staff have no grade" in w for w in warnings))


class CurrencyTests(Base):
    def test_band_rates_in_usd_at_the_finance_rate(self):
        fy26 = plan_settings.resolve("FY26")
        self.assertEqual(fy26["sgdPerUsd"], 1.28)
        self.assertEqual(fy26["bandDayRatesUsd"]["b9"], round(1145 / 1.28, 2))
        self.assertEqual(fy26["bandDayRatesGiven"]["currency"], "SGD")
        self.assertEqual(fy26["revenuePerMonthUsd"], 8_000_000)
        self.assertNotIn("basedOn", fy26)
        self.assertEqual(plan_settings.resolve("FY27")["basedOn"], "FY26", "no FY27 settings yet")
        with self.assertRaises(KeyError):
            plan_settings.resolve("FY25")

    def test_rates_file_is_stored_in_usd(self):
        df = pd.DataFrame({"Grade": ["3", "7"], "Daily Rate": ["256", "500"], "Currency": ["SGD", "usd"]})
        rates, warnings = clean.clean_rates(df, dt.date(2026, 10, 1))
        self.assertEqual(rates["Daily Rate"].tolist(), [200.0, 500.0])
        self.assertEqual(set(rates["Currency"]), {"USD"})
        self.assertTrue(any("1 SGD rates converted" in w for w in warnings))

    def test_rates_file_without_a_known_currency_is_rejected(self):
        with self.assertRaises(clean.CleanError):
            clean.clean_rates(pd.DataFrame({"Grade": ["3"], "Daily Rate": ["200"]}))
        with self.assertRaises(clean.CleanError):
            clean.clean_rates(pd.DataFrame({"Grade": ["3"], "Daily Rate": ["200"], "Currency": ["EUR"]}))


class BreakdownTests(Base):
    def test_agency_and_project_figures_per_month(self):
        import pandas as pd
        sl = pd.DataFrame([
            # demand type, project, customer, IT code, grade, month, man-days
            ("Project", "P1", "Agency X", "a1", 7, "2026-10-01", 18.0),
            ("Project", "P1", "Agency X", "s1", 5, "2026-10-01", 9.0),
            ("Project", "P2", "Agency X", "a1", 7, "2026-10-01", 0.0),     # no man-days: not counted as a person
            ("Quote Won", "P2", "Agency X", None, 6, "2026-10-01", 18.0),  # demand without a named person
            ("Pre Sales", "P3", "Agency Y", "z1", 6, "2026-10-01", 18.0),  # not won or ongoing work
        ], columns=["Demand Type", "ID", "Customer", "IT Code", "Grade", "Calendar Date", "MD"])
        sl["Name"] = sl["ID"]
        self.store.write_table("clean/sl_rp/latest.json.gz", sl)
        self.store.write_table("clean/bu_ur/latest.json.gz", pd.DataFrame([
            ("a1", "2026-10", "Tier B", 18.0, 21.0), ("s1", "2026-10", "Tier S_B", 21.0, 21.0)],
            columns=["IT Code", "Month", "Tier", "Billable", clean.UR_WORKING_DAYS]))
        split, _ = capacity._breakdown(self.store, ["2026-10"])
        x = split["agencies"]["Agency X"]["byMonth"]["2026-10"]
        self.assertEqual((x["fte"], x["people"], x["permanent"], x["secondment"]), (2.5, 2, 1, 1))
        self.assertEqual((x["billable"], x["workingDays"]), (39.0, 42.0), "for the selection's UR")
        self.assertNotIn("Agency Y", split["agencies"], "Pre Sales is not demand")
        self.assertEqual(split["projects"]["P2"]["byMonth"]["2026-10"]["people"], 0)
        self.assertEqual(split["projects"]["P2"]["agency"], "Agency X")


def clocking_fixture(store):
    """SL x RP (P1, P2, people a1, b1, c1) and the UR report (a1 20 days, b1 14) for October 2026."""
    sl = pd.DataFrame([
        # demand type, project, customer, name, IT code, grade, month, man-days
        ("Project", "P1", "Agency X", "Person A", "a1", 7, "2026-10-01", 18.0),
        ("Project", "P1", "Agency X", "Person B", "b1", 5, "2026-10-01", 9.0),
        ("Project", "P2", "Agency X", "Person B", "b1", 5, "2026-10-01", 9.0),     # B is split over P1 and P2
        ("Project", "P2", "Agency X", "Person C", "c1", 5, "2026-10-01", 18.0),    # C has no clocking
        ("Project", "P1", "Agency X", "Person A", "a1", 7, "2026-11-01", 18.0),    # a forecast month
    ], columns=["Demand Type", "ID", "Customer", "Resource", "IT Code", "Grade", "Calendar Date", "MD"])
    sl["Name"] = sl["ID"].map({"P1": "Helpdesk", "P2": "Network"})
    sl["Position Name"] = "Engineer"
    store.write_table("clean/sl_rp/latest.json.gz", sl)
    store.write_table("clean/bu_ur/latest.json.gz", pd.DataFrame([
        ("a1", "2026-10", "Tier B", 20.0, 22.0), ("b1", "2026-10", "Tier B", 14.0, 22.0)],
        columns=["IT Code", "Month", "Tier", "Billable", clean.UR_WORKING_DAYS]))


class ClockingTests(Base):
    """4 Nov 2026: HC from names, FTE from clocking (UR report billable days / 18), red below 15.3 or above 18."""

    def setUp(self):
        super().setUp()
        clocking_fixture(self.store)


    def test_actual_days_are_split_by_plan_share(self):
        pm = clocking.person_months(self.store, ["2026-10"]).set_index(["project", "itCode"])
        self.assertEqual(pm.loc[("P1", "a1"), "actualDays"], 20.0)
        self.assertEqual(pm.loc[("P1", "b1"), "actualDays"], 7.0, "half of B's 14 clocked days")
        self.assertEqual(pm.loc[("P2", "b1"), "projectsThatMonth"], 2)
        self.assertTrue(pd.isna(pm.loc[("P2", "c1"), "clockedDays"]), "not on the UR report")

    def test_roster_plan_vs_actual_with_names(self):
        pm = clocking.person_months(self.store, ["2026-10", "2026-11"])
        r = clocking.roster(self.store, pm, {}, {}, {}, {"2026-10"})
        oct_ = r["projects"]["P1"]["byMonth"]["2026-10"]
        self.assertEqual((oct_["headcount"], oct_["planDays"], oct_["actualDays"]), (2, 27.0, 27.0))
        self.assertEqual((oct_["planFte"], oct_["actualFte"], oct_["daysPerHead"]), (1.5, 1.5, 17.0))
        b = next(p for p in oct_["people"] if p["name"] == "Person B")
        self.assertEqual((b["planDays"], b["clockedDaysAllProjects"], b["actualDays"], b["split"]), (9.0, 14.0, 7.0, True))
        nov = r["projects"]["P1"]["byMonth"]["2026-11"]
        self.assertEqual((nov["actual"], nov["actualDays"], nov["planFte"]), (False, None, 1.0), "forecast: plan only")
        self.assertEqual(r["projects"]["P2"]["byMonth"]["2026-10"]["notClocked"], 1)
        self.assertEqual((r["projects"]["P1"]["name"], r["projects"]["P1"]["agency"]), ("Helpdesk", "Agency X"))

    def test_the_15_3_to_18_days_rule(self):
        rules = plan_settings.PRODUCTIVITY["flags"]["utilisation"]
        self.assertEqual([clocking.utilisation_flag(d, rules) for d in (15.2, 15.3, 18.0, 18.1, None)],
                         ["red", "green", "green", "red", None])

    def test_productivity_uses_clocked_fte_and_headcount(self):
        abcd = pd.DataFrame([("P1", "Helpdesk", "Agency X", "2026-10", 300_000.0, True),
                             ("P2", "Network", "Agency X", "2026-10", 100_000.0, True)],
                            columns=["Project_ID", "Project_Name", "End_Customer", "Month", "Revenue", "Actual"])
        settings = {"FY26": plan_settings.resolve("FY26")}
        prod, _ = capacity._productivity(self.store, abcd, settings, {"2026-10": 22.0}, {"2026-10"})
        a = prod["agencies"][0]
        self.assertEqual((a["headcount"], a["fte"], a["planFte"]), (3.0, 1.89, 3.0))
        self.assertEqual(a["daysPerHead"], 17.0, "A 20 and B 14 clocked; C has no clocking")
        p2 = next(p for p in a["projects"] if p["projectId"] == "P2")
        self.assertEqual((p2["headcount"], p2["daysPerHead"], p2["utilisationFlag"]), (2, 14.0, "red"))
        self.assertIn("under-utilised", p2["flagReason"])


class MspoClockingTests(Base):
    """4 Nov 2026: FTE actual from the MSPO clocking export (hours by person, project and month), when uploaded."""

    def mspo_xlsx(self) -> bytes:
        wb = Workbook()
        ws = wb.active
        ws.title = "Timesheet"
        ws.append(["Timesheet Month", "Resource", "IT Code", "Project ID", "Project Name", "Customer", "Billable",
                   "Hours", "Man-days"])
        for row in [
            (dt.datetime(2026, 10, 1), "Person A", "a1", "P1", "Helpdesk", "Agency X", "Yes", 160, 20),
            (dt.datetime(2026, 10, 1), "Person B", "b1", "P1", "Helpdesk", "Agency X", "Yes", 40, 5),
            (dt.datetime(2026, 10, 1), "Person B", "b1", "P2", "Network", "Agency X", "Yes", 72, 9),   # not 7 / 7
            (dt.datetime(2026, 10, 1), "Person D", "d1", "P2", "Network", "Agency X", "Yes", 144, None),  # unplanned
            (dt.datetime(2026, 10, 1), "Person B", "b1", "INTERNAL", "Internal", None, "No", 16, 2),
        ]:
            ws.append(list(row))
        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    def setUp(self):
        super().setUp()
        clocking_fixture(self.store)

    def test_detected_and_cleaned(self):
        import lambda_function
        result = lambda_function.lambda_handler(s3_event(self.put("MSPO_Clocking.xlsx", self.mspo_xlsx())))
        self.assertEqual(result["files"][0]["dataset"], "mspo_clocking")
        rows = self.store.read_table("clean/mspo_clocking/all.json.gz")
        d1 = rows[rows["IT Code"] == "d1"].iloc[0]
        self.assertEqual(d1["Days"], 18.0, "no Man-days: hours / 8")

    def test_exact_by_project_and_unplanned_work(self):
        import lambda_function
        lambda_function.lambda_handler(s3_event(self.put("MSPO_Clocking.xlsx", self.mspo_xlsx())))
        self.assertEqual(clocking.source(self.store), "mspo")
        pm = clocking.person_months(self.store, ["2026-10"]).set_index(["project", "itCode"])
        self.assertEqual((pm.loc[("P1", "b1"), "actualDays"], pm.loc[("P2", "b1"), "actualDays"]), (5.0, 9.0),
                         "by project as clocked, not split by plan")
        self.assertEqual(pm.loc[("P2", "b1"), "clockedDays"], 14.0, "billable days only, all projects")
        self.assertEqual((pm.loc[("P2", "d1"), "planDays"], pm.loc[("P2", "d1"), "actualDays"]), (0.0, 18.0))
        self.assertTrue(pd.isna(pm.loc[("P2", "c1"), "clockedDays"]), "planned but not on the export")
        self.assertEqual(clocking.billable_days_by_month(self.store), {"2026-10": 52.0})

    def test_breakdown_carries_fte_actual(self):
        import lambda_function
        lambda_function.lambda_handler(s3_event(self.put("MSPO_Clocking.xlsx", self.mspo_xlsx())))
        split, _ = capacity._breakdown(self.store, ["2026-10", "2026-11"])
        self.assertEqual(split["projects"]["P1"]["byMonth"]["2026-10"]["actualFte"], round(25 / 18, 2))
        self.assertEqual(split["agencies"]["Agency X"]["byMonth"]["2026-10"]["actualFte"], round(52 / 18, 2))
        self.assertNotIn("actualFte", split["projects"]["P1"]["byMonth"]["2026-11"], "not clocked yet")


class CapacityInputsTests(Base):
    def test_inputs_after_uploading_the_ur_report_and_staff_list(self):
        import lambda_function
        for name, data in (("BU_UR.xlsx", ur_xlsx()), ("MSPO SG Staff List.xlsx", staff_xlsx())):
            lambda_function.lambda_handler(s3_event(self.put(name, data)))
        inputs = self.store.read_json(capacity.KEY)
        self.assertEqual(inputs["currency"], "USD")
        months = inputs["months"]
        self.assertEqual((len(months), months[0]["month"], months[-1]["month"]), (24, "2026-04", "2028-03"))
        self.assertEqual([m["month"] for m in months if m["actual"]], ["2026-04", "2026-05"])
        self.assertAlmostEqual(inputs["billableUr"]["2026-04"]["b3"], round(39 / 42, 6))
        self.assertAlmostEqual(inputs["billableUr"]["2026-04"]["all"], round(49 / 84, 6))
        self.assertEqual(inputs["workingDays"], {"2026-04": 21.0, "2026-05": 19.0})
        self.assertEqual(inputs["startingHeadcount"], {"month": "2026-04", "bands": {"b3": 2, "b7": 1},
                                                       "source": "bu_ur"},
                         "staff with a grade on the UR report's first month")
        hb = inputs["headcountBreakdown"]
        self.assertEqual((hb["permanent"], hb["secondment"]),
                         ({"regular": 2, "supplementalOther": 1, "supplementalRetiree": 0}, 1))
        self.assertEqual(inputs["settings"]["FY27"]["basedOn"], "FY26")
        self.assertTrue(any("FY27 has no settings" in n for n in inputs["notes"]))
        self.assertEqual(inputs["sources"]["bu_ur"]["file"], "abc-BU_UR.xlsx")

    def test_joiners_come_from_the_latest_reviews_hiring_gap(self):
        import lambda_function
        self.store.write_json("results/latest.json", {"runId": "r1", "prefix": "results/r1/",
                                                      "publishedAt": "2026-10-22T09:00:00+00:00"})
        self.store.write_json("results/r1/summary/hiring_gap.json", [
            {"month": "2026-04", "band": 6, "role": "Server Engineer", "heads": 1},     # actual month: moved
            {"month": "2026-07", "band": 7, "role": "Cloud Engineer L2", "heads": 2},
            {"month": "2026-07", "band": 7, "role": "DCOps", "heads": 1},
            {"month": "2026-08", "band": 0, "role": "UNMAPPED - FOR REVIEW", "heads": 1},  # no band: left out
            {"month": "2031-01", "band": 5, "role": "Tester/QA", "heads": 1},             # after the plan
        ])
        for name, data in (("BU_UR.xlsx", ur_xlsx()), ("MSPO SG Staff List.xlsx", staff_xlsx())):
            lambda_function.lambda_handler(s3_event(self.put(name, data)))
        hires = self.store.read_json(capacity.KEY)["hiringNeeds"]
        self.assertEqual(hires["runId"], "r1")
        self.assertEqual(hires["byMonth"]["2026-06"], {"b6": {"heads": 1, "roles": {"Server Engineer": 1}}},
                         "needed in an actual month (Apr): counted in the first forecast month (Jun)")
        self.assertEqual(hires["byMonth"]["2026-07"]["b7"],
                         {"heads": 3, "roles": {"Cloud Engineer L2": 2, "DCOps": 1}})
        self.assertNotIn("2026-08", hires["byMonth"], "no band, so not a joiner")
        notes = " ".join(self.store.read_json(capacity.KEY)["notes"])
        self.assertIn("default to the 4 people", notes)
        self.assertIn("1 hires have no band", notes)
        self.assertIn("1 hires fall after the plan", notes)

    def test_on_demand_with_nothing_uploaded(self):
        import lambda_function
        result = lambda_function.lambda_handler({"mode": "capacity_inputs"})
        self.assertTrue(any("no UR report" in n for n in result["notes"]))
        inputs = self.store.read_json(capacity.KEY)
        self.assertIsNone(inputs["startingHeadcount"])
        self.assertFalse(any(m["actual"] for m in inputs["months"]))


class InsightsTests(Base):
    def test_dashboard_insights_from_the_uploaded_files(self):
        import lambda_function
        for name, data in (("BU_UR.xlsx", ur_xlsx()), ("MSPO SG Staff List.xlsx", staff_xlsx()),
                           ("YTD_Pipeline.xlsx", sfdc_xlsx())):
            lambda_function.lambda_handler(s3_event(self.put(name, data)))
        monthly = self.store.read_table("clean/sfdc_pipeline/monthly_revenue.json.gz")
        self.assertEqual(sorted(monthly[monthly["CRM ID"] == "CRM-1"]["Month"]),
                         ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"])

        data = insights.build(self.store, dt.date(2026, 10, 15))
        self.assertIsNone(data["pipeline"], "the SFDC pipeline is out of scope since the 28 Oct demo")
        pipe = insights.sales_pipeline(self.store, dt.date(2026, 10, 15))      # kept for when it comes back
        self.assertEqual(pipe["kpis"]["openCount"], 3, "O4, O3 and O2; Closed Lost is not open")
        self.assertEqual([s["stage"][:2] for s in pipe["byStage"]], ["O2", "O3", "O4"])
        o4 = next(s for s in pipe["byStage"] if s["stage"].startswith("O4"))
        self.assertEqual((o4["tcv"], o4["weightedTcv"]), (100000, 60000), "TCV x probability")
        oct_ = pipe["revenueByMonth"][0]
        self.assertEqual((oct_["month"], oct_["open"], oct_["openWeighted"]), ("2026-10", 10, 6.0))
        self.assertEqual(pipe["topOpen"][0]["crmId"], "CRM-2", "largest weighted TCV first")
        self.assertEqual(pipe["kpis"]["winRate"], 0.0, "one closed in the last 12 months, and it was lost")

        util = data["utilisation"]
        self.assertEqual(util["latestMonth"], "2026-05")
        self.assertEqual(util["overallTarget"], 0.854)
        self.assertEqual(util["nonBillableByMonth"][0]["workingDays"], 84)
        self.assertIsNone(data["resources"], "no review completed, so no roll-off figures")
        self.assertEqual(data["workforce"]["upcomingLeaversTotal"], 0)
        self.assertTrue(self.store.exists(insights.KEY), "written when the files were cleaned")


if __name__ == "__main__":
    unittest.main()
