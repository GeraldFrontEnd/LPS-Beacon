"""The capacity plan (Analysis page): every cell worked out from the pipeline's inputs and the cells people
typed in. Standard library only, like the rest of the API Lambda.

Inputs   results/capacity/inputs.json, written by the forecast pipeline (pipeline/capacity.py): months,
         settings per fiscal year (UR targets, USD day rates, revenue placeholder), actual Billable UR and
         working days from the UR report, and the starting headcount from the staff list.
Edits    {"<rowId>|<columnKey>": number}: the cells people changed (shared by everyone, see the API Lambda).

The layout mirrors the web app's src/analysis/capacityPlanLayout.ts and Capacity_Plan_template.xlsx:
  row ids      "<section>" for a total row, "<section>:<band>" for a band row (bands b9 .. b3)
  column keys  months "Apr'26", quarters "Q1'26" (Apr-Jun), fiscal years "FY'26"

Formulas per band and month (all money in USD):
  Current HC        first month: the staff list (editable); later months: the previous month's Ending HC
  Joiners           the latest review's hiring gap for that month and band (inputs "hiringNeeds"), else 0;
                    editable. Leavers: 0 until typed in.
  Ending HC         Current HC + Joiners - Leavers
  Billable UR       actual months: the UR report; forecast months: the fiscal year's target (editable)
  Billable HC       Ending HC x Billable UR;  Non-Billable HC = Ending HC - Billable HC
  Revenue per FTE   Ending HC x day rate x Billable UR x working days
  Resource Cost     Ending HC x day rate x working days
  Joiners %         Joiners / Ending HC;  Leavers % = Leavers / Current HC   (as in the template)
Totals: headcount, cost and revenue per FTE add up the bands. The total Billable UR is the UR report's figure
  for all staff in actual months and the fiscal year's overall target in forecast months (the template's row 54),
  not an average of the bands.
  Revenue           typed in by Finance; placeholder from the settings ($8M a month)
  Gross Margin      Revenue - Resource Cost;  Gross Margin % = Gross Margin / Revenue
Quarter and year columns:
  Current HC        the opening headcount: the first month's Current HC
  Ending HC         the closing headcount: the last month's Ending HC
  Billable HC, Non-Billable HC   averages of the months (capacity used over the period)
  flows (joiners, leavers, money, days)   sums
  ratios            worked out again from those, with the period's AVERAGE headcount as the base
(The Excel template averages Current and Ending HC too; opening and closing are the right figures for a
headcount at a point in time, so this deliberately differs from the template.)
"""
from __future__ import annotations

import calendar
import datetime as dt

BANDS = ("b9", "b8", "b7", "b6", "b5", "b4", "b3")
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

SECTIONS = ("current-hc", "joiners", "leavers", "ending-hc", "revenue-per-fte", "revenue", "resource-cost",
            "gross-margin", "gross-margin-pct", "billable-ur", "billable-hc", "non-billable-hc", "working-days",
            "joiners-pct", "leavers-pct")
BAND_SECTIONS = {"current-hc", "joiners", "leavers", "ending-hc", "revenue-per-fte", "resource-cost",
                 "billable-ur", "billable-hc", "non-billable-hc", "joiners-pct", "leavers-pct"}
AVERAGED = {"billable-hc", "non-billable-hc"}
OPENING = {"current-hc"}   # quarter / year column = the first month's value
CLOSING = {"ending-hc"}    # quarter / year column = the last month's value
SUMMED = {"joiners", "leavers", "revenue-per-fte", "revenue", "resource-cost", "gross-margin", "working-days"}
MONEY = {"revenue-per-fte", "revenue", "resource-cost", "gross-margin"}

# What a person may type (the same rule as isEditableCell in the web app), and the allowed range.
EDITABLE_BAND_SECTIONS = {"joiners": (0, 10_000), "leavers": (0, 10_000), "billable-ur": (0, 1.5)}
EDITABLE_TOTAL_SECTIONS = {"revenue": (0, 10_000_000_000), "working-days": (0, 31)}
FIRST_MONTH_ONLY = {"current-hc": (0, 100_000)}


class EditError(ValueError):
    """The edit is not allowed (not an input cell, or a value out of range)."""


def column_key(month: str) -> str:
    """"2026-04" -> "Apr'26"."""
    year, number = month.split("-")
    return f"{MONTH_NAMES[int(number) - 1]}'{year[2:]}"


def _fy_key(fiscal_year: str) -> str:
    return f"FY'{fiscal_year[2:]}"          # "FY26" -> "FY'26"


def _quarter_key(fiscal_year: str, month: str) -> str:
    number = int(month.split("-")[1])
    quarter = {4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 1: 4, 2: 4, 3: 4}[number]
    return f"Q{quarter}'{fiscal_year[2:]}"


def weekdays(month: str) -> int:
    """Monday to Friday in a month: the default working days of a forecast month (public holidays not taken off)."""
    year, number = (int(p) for p in month.split("-"))
    days = calendar.monthrange(year, number)[1]
    return sum(1 for d in range(1, days + 1) if dt.date(year, number, d).weekday() < 5)


def check_edit(inputs: dict, row_id: str, column: str, value) -> float | None:
    """The value to store for this cell, or None to remove the edit. Raises EditError when not allowed."""
    months = [column_key(m["month"]) for m in inputs["months"]]
    if column not in months:
        raise EditError("Only month cells can be changed; quarter and year totals are worked out from the months")
    section, _, band = row_id.partition(":")
    if band:
        if band not in BANDS:
            raise EditError("Unknown band")
        limits = EDITABLE_BAND_SECTIONS.get(section)
        if section in FIRST_MONTH_ONLY:
            if column != months[0]:
                raise EditError("Current HC can only be changed in the first month; later months follow from it")
            limits = FIRST_MONTH_ONLY[section]
    else:
        limits = EDITABLE_TOTAL_SECTIONS.get(section)
    if limits is None:
        raise EditError("This cell is worked out from other cells and can't be typed in")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise EditError("Send a number")
    low, high = limits
    if not low <= value <= high:
        raise EditError(f"The value must be between {low:g} and {high:g}")
    return float(value)


def build(inputs: dict, edits: dict[str, float]) -> dict[str, dict[str, float | None]]:
    """Every cell of the plan: {rowId: {columnKey: value}}."""
    values: dict[str, dict[str, float | None]] = {}

    def put(row: str, col: str, v):
        values.setdefault(row, {})[col] = v

    def edited(row: str, col: str):
        return edits.get(f"{row}|{col}")

    months = inputs["months"]
    start = (inputs.get("startingHeadcount") or {}).get("bands") or {}
    previous_end = {b: float(start.get(b, 0)) for b in BANDS}
    ur_actual = inputs.get("billableUr") or {}
    days_actual = inputs.get("workingDays") or {}
    hires = (inputs.get("hiringNeeds") or {}).get("byMonth") or {}

    for index, m in enumerate(months):
        month, fy = m["month"], m["fiscalYear"]
        col = column_key(month)
        settings = inputs["settings"][fy]
        rates = settings["bandDayRatesUsd"]
        targets = settings["urTargets"]
        default_days = days_actual.get(month) if m.get("actual") and month in days_actual else weekdays(month)
        days = edited("working-days", col)
        days = float(default_days) if days is None else days
        total = dict.fromkeys(("cur", "join", "leave", "end", "rev", "cost", "bill"), 0.0)

        for b in BANDS:
            cur = previous_end[b]
            if index == 0 and edited(f"current-hc:{b}", col) is not None:
                cur = edited(f"current-hc:{b}", col)
            join = edited(f"joiners:{b}", col)
            if join is None:
                join = float(((hires.get(month) or {}).get(b) or {}).get("heads", 0))
            leave = edited(f"leavers:{b}", col) or 0.0
            end = cur + join - leave
            ur = edited(f"billable-ur:{b}", col)
            if ur is None:
                actual_ur = (ur_actual.get(month) or {}).get(b) if m.get("actual") else None
                ur = actual_ur if actual_ur is not None else targets.get(b, targets.get("all", 0.0))
            billable = end * ur
            revenue_fte = billable * rates[b] * days
            cost = end * rates[b] * days
            for section, v in (("current-hc", cur), ("joiners", join), ("leavers", leave), ("ending-hc", end),
                               ("billable-ur", ur), ("billable-hc", billable), ("non-billable-hc", end - billable),
                               ("revenue-per-fte", revenue_fte), ("resource-cost", cost),
                               ("joiners-pct", join / end if end else 0.0),
                               ("leavers-pct", leave / cur if cur else 0.0)):
                put(f"{section}:{b}", col, v)
            previous_end[b] = end
            for k, v in (("cur", cur), ("join", join), ("leave", leave), ("end", end), ("rev", revenue_fte),
                         ("cost", cost), ("bill", billable)):
                total[k] += v

        all_ur = (ur_actual.get(month) or {}).get("all") if m.get("actual") else None
        all_ur = targets.get("all", 0.0) if all_ur is None else all_ur
        revenue = edited("revenue", col)
        revenue = float(settings["revenuePerMonthUsd"]) if revenue is None else revenue
        margin = revenue - total["cost"]
        for section, v in (("current-hc", total["cur"]), ("joiners", total["join"]), ("leavers", total["leave"]),
                           ("ending-hc", total["end"]), ("revenue-per-fte", total["rev"]),
                           ("resource-cost", total["cost"]), ("billable-hc", total["bill"]),
                           ("non-billable-hc", total["end"] - total["bill"]),
                           ("billable-ur", all_ur),
                           ("working-days", days), ("revenue", revenue), ("gross-margin", margin),
                           ("gross-margin-pct", margin / revenue if revenue else 0.0),
                           ("joiners-pct", total["join"] / total["end"] if total["end"] else 0.0),
                           ("leavers-pct", total["leave"] / total["cur"] if total["cur"] else 0.0)):
            put(section, col, v)

    # Quarter and fiscal-year columns.
    groups: dict[str, list[str]] = {}
    for m in months:
        col = column_key(m["month"])
        groups.setdefault(_quarter_key(m["fiscalYear"], m["month"]), []).append(col)
        groups.setdefault(_fy_key(m["fiscalYear"]), []).append(col)
    for key, cols in groups.items():
        def total_of(row):
            return sum(values[row][c] or 0.0 for c in cols)

        def avg(row):
            return total_of(row) / len(cols)

        for section in SECTIONS:
            rows = [section] + ([f"{section}:{b}" for b in BANDS] if section in BAND_SECTIONS else [])
            for row in rows:
                suffix = row[len(section):]
                if section in OPENING:
                    v = values[row][cols[0]] or 0.0
                elif section in CLOSING:
                    v = values[row][cols[-1]] or 0.0
                elif section in AVERAGED:
                    v = avg(row)
                elif section in SUMMED:
                    v = total_of(row)
                elif section == "gross-margin-pct":
                    v = total_of("gross-margin") / total_of("revenue") if total_of("revenue") else 0.0
                elif section == "billable-ur" and not suffix:
                    v = avg(row)  # the total row: the average of the months' overall UR
                elif section == "billable-ur":
                    end = avg(f"ending-hc{suffix}")
                    v = avg(f"billable-hc{suffix}") / end if end else 0.0
                elif section == "joiners-pct":
                    end = avg(f"ending-hc{suffix}")
                    v = total_of(f"joiners{suffix}") / end if end else 0.0
                else:  # leavers-pct
                    cur = avg(f"current-hc{suffix}")
                    v = total_of(f"leavers{suffix}") / cur if cur else 0.0
                put(row, key, v)

    for row, cells in values.items():
        if row.split(":")[0] in MONEY:
            for col, v in cells.items():
                cells[col] = round(v, 2)
    return values
