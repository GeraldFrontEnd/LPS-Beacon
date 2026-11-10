"""The chat's analytics tools (3 Nov 2026 instructions, section 10): productivity, FTE required, hiring what-if,
redeployment soonest-first, bench by quarter, and headcount / demand for the organisation or one agency.

Standard library only, like the rest of the API Lambda. Every function takes the data it needs as plain dicts (so the
tests need no AWS) and returns a JSON-able dict for the model:
  inputs    results/capacity/inputs.json    written by the pipeline (pipeline/capacity.py)
  values    capacity_plan.build(inputs, edits)  the capacity plan with people's edits, {rowId: {columnKey: value}}
  insights  results/dashboard/insights.json written by the pipeline (pipeline/insights.py), for "availability"

The formulas are the same as the web app's Analysis page and Dashboard (src/analysis/baseline.ts) and the
pipeline's (pipeline/capacity.py), so the chat, the pages and the pipeline give the same figures:
  Revenue per HC         revenue this fiscal year to date, annualised / average delivery HC
  GP per HC              (revenue - HC cost at the rate card) annualised / average delivery HC
  Revenue per $ HC cost  revenue / HC cost at the rate card
  Weighted iRate         sum(HC in each band x the band's iRate) / sum(HC), the latest actual month
  FTE / revenue calculator (5 Nov 2026 review): revenue per FTE-day = ADR (revenue / billable days clocked);
                         revenue one FTE brings a year = ADR x 18 x 12; FTE needed = revenue / that / UR, or the
                         revenue an FTE count brings = FTE x UR x that
"""
from __future__ import annotations

import datetime

MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MAX_ROWS = 25


def _key(month):
    """"2026-04" -> "Apr'26", the capacity plan's column key."""
    year, number = month.split("-")
    return f"{MONTH_NAMES[int(number) - 1]}'{year[2:]}"


def _r(value, digits=0):
    return None if value is None else round(value, digits) if digits else round(value)


def _contains(value, wanted):
    return not wanted or str(wanted).lower() in str(value or "").lower()


# ---------------------------------------------------------------- organisation baseline
def _latest_actual(inputs):
    actual = [m for m in inputs.get("months") or [] if m.get("actual")]
    return actual[-1] if actual else None


def reporting_year(inputs):
    prod = inputs.get("productivity") or {}
    if prod.get("fiscalYear"):
        return prod["fiscalYear"]
    last = _latest_actual(inputs)
    return last["fiscalYear"] if last else None


def weighted_irate(inputs, values, month):
    """Weighted cost per FTE per day (USD) in a month: the rate card by band, weighted by that month's headcount."""
    fy = next((m["fiscalYear"] for m in inputs["months"] if m["month"] == month), None)
    rates = ((inputs.get("settings") or {}).get(fy) or {}).get("bandDayRatesUsd") or {}
    col = _key(month)
    heads = cost = 0.0
    for band, rate in rates.items():
        hc = (values.get(f"ending-hc:{band}") or {}).get(col) or 0.0
        heads += hc
        cost += hc * rate
    return cost / heads if heads else None


def baseline(inputs, values):
    """The organisation's productivity this fiscal year to date (annualised), and last year's when known."""
    fy = reporting_year(inputs)
    months = [m["month"] for m in inputs.get("months") or [] if m["fiscalYear"] == fy and m.get("actual")]
    if not months:
        return None
    sums = {row: sum((values.get(row) or {}).get(_key(m)) or 0.0 for m in months)
            for row in ("revenue", "resource-cost", "ending-hc")}
    hc = sums["ending-hc"] / len(months)
    annual = 12 / len(months)
    out = {
        "fiscalYear": fy, "fromMonth": months[0], "toMonth": months[-1],
        "revenueAnnualisedUsd": _r(sums["revenue"] * annual), "averageHeadcount": _r(hc, 1),
        "revenuePerHcUsd": _r(sums["revenue"] * annual / hc) if hc else None,
        "gpPerHcUsd": _r((sums["revenue"] - sums["resource-cost"]) * annual / hc) if hc else None,
        "revenuePerDollarOfHcCost": _r(sums["revenue"] / sums["resource-cost"], 2) if sums["resource-cost"] else None,
        "weightedCostPerFtePerDayUsd": _r(weighted_irate(inputs, values, months[-1])),
        "basis": "revenue from the ABCD report (Singapore delivery); HC = delivery headcount on the capacity plan; "
                 "GP = revenue minus HC cost at the rate card (iRate); per-HC figures are yearly rates",
    }
    prior = ((inputs.get("settings") or {}).get(fy) or {}).get("priorYear")
    revenue_by_month = inputs.get("revenue") or {}
    if prior:
        start = 2000 + int(prior["fiscalYear"][2:])
        prior_months = [f"{start + (i + 3) // 12}-{(i + 3) % 12 + 1:02d}" for i in range(12)]
        if all(m in revenue_by_month for m in prior_months):
            revenue = sum(revenue_by_month[m]["revenue"] for m in prior_months)
            head, cost = prior["averageHeadcount"], prior["staffCostUsd"]
            out["lastYear"] = {
                "fiscalYear": prior["fiscalYear"], "revenueUsd": _r(revenue), "averageHeadcount": head,
                "revenuePerHcUsd": _r(revenue / head), "gpPerHcUsd": _r((revenue - cost) / head),
                "revenuePerDollarOfHcCost": _r(revenue / cost, 2),
                "basis": f"ABCD revenue; headcount and staff cost from the {prior['source']}",
            }
    return out


# ---------------------------------------------------------------- productivity by agency / project
def _figures(item):
    keep = ("revenue", "headcount", "fte", "planFte", "daysPerHead", "revenuePerFte", "gpPerFte", "revenuePerHcCost",
            "requiredFte", "flag", "utilisationFlag", "flagReason")
    out = {k: item.get(k) for k in keep}
    out["revenueToDateUsd"] = _r(out.pop("revenue"))
    out["deliveryFteClocked"] = out.pop("fte")
    out["plannedFte"] = out.pop("planFte")
    out["clockedDaysPerHeadPerMonth"] = out.pop("daysPerHead")
    out["revenuePerFteUsd"] = _r(out.pop("revenuePerFte"))
    out["gpPerFteUsd"] = _r(out.pop("gpPerFte"))
    out["revenuePerDollarOfHcCost"] = out.pop("revenuePerHcCost")
    out["calculatedFteRequired"] = out.pop("requiredFte")
    # Band mix (10 Nov 2026): % of the people in band 7 or 8, latest month (headcount, not FTE).
    mix = item.get("bandMix")
    out["bandMixPct"] = round(100 * mix, 1) if mix is not None else None
    # Billable UR (6 Nov 2026): billable days / working days over the months, shared people split by clocked days.
    months = (item.get("byMonth") or {}).values()
    work = sum(c.get("workingDays") or 0 for c in months)
    out["billableUrPct"] = round(100 * sum(c.get("actualDays") or 0 for c in months) / work, 1) if work else None
    out["averageBillableMdPerHeadPerMonth"] = out.pop("clockedDaysPerHeadPerMonth")
    return out


def productivity(inputs, values, args):
    """Baseline plus agencies (or one agency's projects, or one project), filtered."""
    prod = inputs.get("productivity")
    if not prod:
        return {"error": "Productivity by agency needs an ABCD report with actual months and an SL x RP file."}
    level = args.get("level") if args.get("level") in ("organisation", "agency", "project") else "agency"
    name = str(args.get("name") or "").strip()
    flag = args.get("flag") if args.get("flag") in ("red", "amber", "green") else None
    below = bool(args.get("belowAverageOnly"))
    avg = prod.get("companyAverage") or {}
    rules = prod.get("rules") or {}
    out = {"baseline": baseline(inputs, values),
           "companyAverage": {"revenuePerFteUsd": _r(avg.get("revenuePerFte")), "gpPerFteUsd": _r(avg.get("gpPerFte")),
                              "revenuePerDollarOfHcCost": avg.get("revenuePerHcCost"),
                              "basis": f"all agencies with at least {rules.get('minFte', 1)} delivery FTE, "
                                       "FTE = clocked billable days / 18 (UR report), revenue from ABCD, yearly rates"},
           "period": {"fiscalYear": prod.get("fiscalYear"), "months": prod.get("months")},
           "flagRules": {"draft": rules.get("draft"), "metrics": rules.get("metrics"),
                         "redBelowAveragePct": (rules.get("productivity") or {}).get("redBelowPct"),
                         "amberBelowAveragePct": (rules.get("productivity") or {}).get("amberBelowPct"),
                         "utilisation": "red when the average clocked billable days per head a month is below "
                                        f"{(rules.get('utilisation') or {}).get('redBelowDays', 15.3)} or above "
                                        f"{(rules.get('utilisation') or {}).get('redAboveDays', 18)}"}}
    if level == "organisation":
        return out

    def keep(item):
        if flag and item.get("flag") != flag:
            return False
        if below and not (item.get("revenuePerFte") is not None and avg.get("revenuePerFte")
                          and item["revenuePerFte"] < avg["revenuePerFte"]):
            return False
        return True

    rows = []
    for a in prod.get("agencies") or []:
        if level == "agency":
            if _contains(a.get("agency"), name) and keep(a):
                rows.append({"agency": a["agency"], "projects": len(a.get("projects") or []), **_figures(a)})
        else:
            for p in a.get("projects") or []:
                if (not name or _contains(p.get("projectId"), name) or _contains(p.get("projectName"), name)
                        or _contains(a.get("agency"), name)) and keep(p):
                    rows.append({"projectId": p["projectId"], "projectName": p.get("projectName"),
                                 "agency": a["agency"], **_figures(p)})
    order = {"red": 0, "amber": 1, "green": 2, None: 3}
    rows.sort(key=lambda r: (order.get(r.get("flag"), 3), -(r.get("revenueToDateUsd") or 0)))
    out.update(level=level, totalRows=len(rows), rowsShown=min(len(rows), MAX_ROWS), rows=rows[:MAX_ROWS])
    return out


def _agency(inputs, name):
    prod = inputs.get("productivity") or {}
    found = [a for a in prod.get("agencies") or [] if _contains(a.get("agency"), name)]
    exact = [a for a in found if a.get("agency", "").lower() == str(name).lower()]
    return (exact or found)[:1], found


# ---------------------------------------------------------------- FTE / revenue calculator
def _adr(agencies, months):
    """Average daily revenue: revenue / billable days clocked over the months (pipeline byMonth); for inputs without
    byMonth, revenue / (FTE actual x 18 x months)."""
    revenue = days = 0.0
    for a in agencies:
        by_month = a.get("byMonth")
        if by_month:
            for m in months:
                c = by_month.get(m)
                if c:
                    revenue += c.get("revenue") or 0
                    days += c.get("actualDays") or 0
        else:
            revenue += a.get("revenue") or 0
            days += (a.get("fte") or 0) * 18 * len(months)
    return revenue / days if days else None


def fte_required(inputs, values, args):
    """The Analysis page's calculator (5 Nov 2026), for the organisation or one agency, either way round:
    give revenueUsd to get the FTE it needs, or fte to get the revenue that many FTE bring."""
    fy = reporting_year(inputs)
    target = ((inputs.get("settings") or {}).get(fy) or {}).get("target") or {}
    prod = inputs.get("productivity") or {}
    months = prod.get("months") or []
    agencies = prod.get("agencies") or []
    agency = str(args.get("agency") or "").strip()
    scope, picked = "organisation", agencies
    # The FTE here apply UR, so they are people at the target UR: they compare with headcount, not clocked FTE.
    last = _latest_actual(inputs)
    current = (values.get("ending-hc") or {}).get(_key(last["month"])) if last else None
    current_label = "headcount today"
    default_revenue = target.get("revenueUsd")
    if agency:
        found_one, found = _agency(inputs, agency)
        if not found_one:
            return {"error": f"No agency matches {agency!r}.", "agenciesFound": [a["agency"] for a in found[:10]]}
        a = found_one[0]
        scope, picked = a["agency"], [a]
        current, current_label = a.get("headcount"), "headcount on its projects (latest month)"
        default_revenue = (a.get("revenue") or 0) * 12 / max(len(months), 1)

    def number(name, default):
        try:
            return float(args[name]) if args.get(name) not in (None, "") else default
        except (TypeError, ValueError):
            return default

    adr = number("adrUsd", _adr(picked, months))
    ur = number("billableUr", target.get("billableUr", 0.87))
    days = number("manDaysPerFte", target.get("manDaysPerFte", 18))
    if ur > 1.5:
        ur /= 100            # "87" means 87 %
    if not (adr and ur > 0 and days > 0):
        return {"error": "Need an ADR (no revenue and clocking yet?), a UR and the man-days per FTE."}
    per_fte = adr * days * 12
    common = {"scope": scope, "adrUsdPerDay": _r(adr), "revenuePerFteYearUsd": _r(per_fte),
              "current": _r(current, 1), "currentIs": current_label,
              "convention": "Revenue per FTE-day = ADR (revenue / billable days clocked, fiscal year to date); "
                            "1 FTE = 18 working days a month; UR applied, so the FTE are people at that UR and "
                            "compare with headcount."}
    fte = number("fte", None)
    if fte is not None and args.get("revenueUsd") in (None, ""):
        billable = fte * ur
        revenue = billable * per_fte
        return {**common, "mode": "revenue from FTE",
                "inputs": {"fte": fte, "billableUr": ur, "manDaysPerFtePerMonth": days, "adrUsdPerDay": _r(adr)},
                "revenueUsd": _r(revenue),
                "formulaSteps": [f"Revenue per FTE-day = ADR ${adr:,.0f}",
                                 f"Revenue one FTE brings a year = ${adr:,.0f} x {days:g} days x 12 = ${per_fte:,.0f}",
                                 f"Billable FTE = {fte:,.1f} x UR {ur:.1%} = {billable:,.1f}",
                                 f"Revenue = {billable:,.1f} x ${per_fte:,.0f} = ${revenue:,.0f}"]}
    revenue = number("revenueUsd", default_revenue)
    if not revenue:
        return {"error": "Need a yearly revenue target (revenueUsd) or an FTE count (fte)."}
    billable = revenue / per_fte
    total = billable / ur
    return {**common, "mode": "FTE from revenue",
            "inputs": {"revenueTargetUsd": _r(revenue), "billableUr": ur, "manDaysPerFtePerMonth": days,
                       "adrUsdPerDay": _r(adr)},
            "billableFteRequired": _r(billable, 1), "totalFteRequired": _r(total, 1),
            "gap": _r(total - current, 1) if current is not None else None,
            "formulaSteps": [f"Revenue per FTE-day = ADR ${adr:,.0f}",
                             f"Revenue one FTE brings a year = ${adr:,.0f} x {days:g} days x 12 = ${per_fte:,.0f}",
                             f"Billable FTE = ${revenue:,.0f} / ${per_fte:,.0f} = {billable:,.1f}",
                             f"Total FTE = {billable:,.1f} / UR {ur:.1%} = {total:,.1f}"]}


def hiring_what_if(inputs, values, args):
    """Revenue per HC (organisation) or per FTE (one agency) now, and after hiring N more: not billable, or billable
    at the target GP (each new FTE adding a year of revenue at the weighted iRate)."""
    try:
        hires = max(0, int(float(args.get("hires") or 0)))
    except (TypeError, ValueError):
        hires = 0
    fy = reporting_year(inputs)
    target = ((inputs.get("settings") or {}).get(fy) or {}).get("target") or {}
    agency = str(args.get("agency") or "").strip()
    if agency:
        picked, found = _agency(inputs, agency)
        if not picked:
            return {"error": f"No agency matches {agency!r}.", "agenciesFound": [a["agency"] for a in found[:10]]}
        a, prod = picked[0], inputs["productivity"]
        scope, unit = a["agency"], "FTE"
        revenue, heads, rate = a.get("revenue", 0) * 12 / len(prod["months"]), a.get("fte") or 0, a.get("ratePerDay")
    else:
        base = baseline(inputs, values)
        if not base:
            return {"error": "No actual months on the capacity plan yet."}
        scope, unit = "organisation", "HC"
        revenue, heads, rate = base["revenueAnnualisedUsd"], base["averageHeadcount"], base["weightedCostPerFtePerDayUsd"]
    if not heads:
        return {"error": f"{scope} has no delivery FTE to divide by."}
    per_fte = 12 * target.get("manDaysPerFte", 18) * rate / (1 - target.get("gpPct", 0.27)) if rate else None
    now = revenue / heads
    cost_only = revenue / (heads + hires)
    billable = (revenue + hires * per_fte) / (heads + hires) if per_fte else None
    return {"scope": scope, "hires": hires, "unit": unit,
            f"revenuePer{unit}NowUsd": _r(now), f"revenuePer{unit}IfNotBillableUsd": _r(cost_only),
            f"revenuePer{unit}IfBillableUsd": _r(billable), "revenuePerNewFteYearUsd": _r(per_fte),
            "formula": f"now = ${revenue:,.0f} / {heads:,.1f}; not billable = same revenue / ({heads:,.1f} + {hires}); "
                       f"billable = (revenue + {hires} x ${per_fte or 0:,.0f}) / ({heads:,.1f} + {hires})",
            "openQuestion": "Whether new hires count as billable is open question #20."}


# ---------------------------------------------------------------- redeployment and bench
def _people(insights):
    return ((insights or {}).get("resources") or {}).get("availability") or []


def _filter_people(people, args):
    position, level = args.get("position"), args.get("level")
    band = str(args.get("band") or "").strip()
    include = bool(args.get("includeRedeployed"))
    for p in people:
        if not _contains(p.get("position"), position):
            continue
        if level and str(p.get("level", "")).lower() != str(level).lower():
            continue
        if band and str(p.get("band")) != band:
            continue
        if not include and p.get("redeployedTo"):
            continue
        yield p


def redeployable(insights, args, today, with_names=True):
    """People in a standardised position, soonest free first, with counts free now / in 1, 3, 6 months."""
    people = sorted(_filter_people(_people(insights), args), key=lambda p: p["availableFrom"])
    if not _people(insights):
        return {"error": "No matching has been published yet, so there is no availability data."}

    def within(months):
        month = today.month - 1 + months
        limit = datetime.date(today.year + month // 12, month % 12 + 1, min(today.day, 28)).isoformat()
        return sum(1 for p in people if p["availableFrom"] <= limit)

    out = {"asOf": today.isoformat(), "position": args.get("position") or "all positions", "total": len(people),
           "freeNow": within(0), "freeWithin1Month": within(1), "freeWithin3Months": within(3),
           "freeWithin6Months": within(6),
           "note": "availableFrom is the first day after the person's last planned month on their current project. "
                   "One row per resource-plan line, as the matching counts them."}
    if not with_names:
        out["names"] = "Names and projects are only shown to Finance/HR users."
        return out
    # No names for anyone (10 Nov 2026 review, PDPA): a name next to a grade identifies the person. A row is a
    # position and its grade; with_names now only decides whether the rows (projects, dates) are shown at all.
    out["names"] = "Names are never shown: each row is a position and its grade."
    rows = [{"position": p.get("position"), "band": p.get("band"),
             "availableFrom": p["availableFrom"], "currentProject": p.get("currentProject"),
             "currentAgency": p.get("currentCustomer"), "alreadyRedeployedTo": p.get("redeployedTo")}
            for p in people]
    out.update(rowsShown=min(len(rows), MAX_ROWS), rows=rows[:MAX_ROWS])
    return out


def bench_by_quarter(insights, args):
    """People becoming free per standardised position and fiscal quarter (Q1 = Apr-Jun) in one fiscal year."""
    people = _people(insights)
    if not people:
        return {"error": "No matching has been published yet, so there is no availability data."}
    years = sorted({p["fiscalYear"] for p in people})
    fy = args.get("fiscalYear") or years[0]
    fy = fy if str(fy).upper().startswith("FY") else f"FY{str(fy)[-2:]}"
    fy = fy.upper().replace("'", "")
    quarter = str(args.get("quarter") or "").upper() or None
    counts = {}
    for p in _filter_people(people, args):
        if p["fiscalYear"] != fy or (quarter and p["quarter"] != quarter):
            continue
        row = counts.setdefault(p.get("position") or "(no position)", {"Q1": 0, "Q2": 0, "Q3": 0, "Q4": 0})
        row[p["quarter"]] += 1
    rows = sorted(({"position": k, **v, "total": sum(v.values())} for k, v in counts.items()),
                  key=lambda r: -r["total"])
    return {"fiscalYear": fy, "quarter": quarter or "all", "fiscalYearsAvailable": years,
            "quarters": "Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar",
            "totals": {q: sum(r[q] for r in rows) for q in ("Q1", "Q2", "Q3", "Q4")},
            "positionCount": len(rows), "positionsShown": min(len(rows), MAX_ROWS), "rows": rows[:MAX_ROWS],
            "note": "people whose current assignment ends in that quarter and who are not yet put on other work "
                    "(unless includeRedeployed)"}


# ---------------------------------------------------------------- headcount and demand today
def headcount_today(inputs, values, args):
    """Headcount, permanent vs secondment, UR, FTE demand and the gap, for the organisation or one agency / project,
    in the latest actual month (or the month asked for)."""
    last = _latest_actual(inputs)
    if not last:
        return {"error": "No actual months on the capacity plan yet."}
    month = str(args.get("month") or last["month"])[:7]
    if month not in {m["month"] for m in inputs["months"]}:
        month = last["month"]
    split = inputs.get("breakdown") or {}
    agency, project = str(args.get("agency") or "").strip(), str(args.get("projectId") or "").strip()
    if project or agency:
        if project:
            found = {k: v for k, v in (split.get("projects") or {}).items()
                     if _contains(k, project) or _contains(v.get("name"), project)}
            kind = "project"
        else:
            found = {k: v for k, v in (split.get("agencies") or {}).items() if _contains(k, agency)}
            kind = "agency"
        if not found:
            return {"error": f"No {kind} matches {project or agency!r} in the uploaded files."}
        if len(found) > 1:
            exact = {k: v for k, v in found.items() if k.lower() == (project or agency).lower()}
            if len(exact) != 1:
                return {"error": f"Several {kind}s match; ask which one.", "matches": sorted(found)[:15]}
            found = exact
        (name, item), = found.items()
        cell = (item.get("byMonth") or {}).get(month)
        if not cell:
            return {"error": f"No people or demand planned for {name} in {month}."}
        ur = cell["billable"] / cell["workingDays"] if cell.get("workingDays") else None
        return {kind: name if kind == "agency" else f"{name} ({item.get('name')})", "month": month,
                "peoplePlanned": cell["people"], "permanent": cell["permanent"], "secondment": cell["secondment"],
                "otherOrUnknownType": cell["other"] + cell["unknown"],
                "billableUr": _r(ur, 3) if ur is not None else None, "fteDemand": cell["fte"],
                "fteActual": cell.get("actualFte"),
                "basis": "people with man-days on its projects that month (SL x RP); employment type from the staff "
                         "list, else the UR report's tier; UR from the UR report; FTE demand (planned) = Project + Quote "
                         "Won man-days / 18; FTE actual = clocked billable days / 18 (MSPO clocking; null = not "
                         "clocked yet). Someone on two projects counts in both."}
    col = _key(month)
    hc = (values.get("ending-hc") or {}).get(col)
    demand = ((inputs.get("demand") or {}).get(month) or {}).get("fte")
    staff = inputs.get("headcountBreakdown") or {}
    perm = staff.get("permanent") or {}
    return {"scope": "organisation", "month": month, "headcount": _r(hc),
            "permanentRegular": perm.get("regular"),
            "supplemental": (perm.get("supplementalOther") or 0) + (perm.get("supplementalRetiree") or 0),
            "secondment": staff.get("secondment"), "staffListAsOf": staff.get("asOf"),
            "billableUr": _r((values.get("billable-ur") or {}).get(col), 3), "fteDemand": demand,
            "fteActual": (inputs.get("actualFte") or {}).get(month),
            "benchOrShortageFte": _r(hc - demand) if hc is not None and demand is not None else None,
            "basis": "headcount = capacity plan Ending HC; employment types from the staff list (permanent = Regular "
                     "Employee; Supplemental shown apart, open question #12); UR from the UR report; FTE demand = SL x "
                     "RP Project + Quote Won man-days / 18 (planned); fteActual = all clocked billable days / 18. benchOrShortageFte = headcount - FTE demand, in FTE (negative = "
                     "short); it is not a number of people."}


# ---------------------------------------------------------------- one project: plan vs actual, and its people
MAX_PEOPLE = 80


def _fy_of(month):
    """"2026-10" -> "FY26" (April to March)."""
    year, number = int(month[:4]), int(month[5:7])
    return f"FY{(year if number >= 4 else year - 1) % 100:02d}"


def project_resources(roster, args, with_names=True):
    """A project's plan and actual: per month of its fiscal year (HC, plan FTE, actual FTE), and for one month
    (the latest month with clocking, or the one asked for) everyone on it with their plan days, clocked days and FTE.
    roster = results/capacity/roster.json (pipeline/clocking.py). Names only for Finance/HR."""
    if not roster or not roster.get("projects"):
        return {"error": "No project roster yet. It is built from the SL x RP file and the UR report: ask a "
                         "Finance/HR user to upload them."}
    wanted = str(args.get("project") or "").strip()
    if not wanted:
        return {"error": "Which project? Give its project ID or part of its name."}
    projects = roster["projects"]
    found = {k: v for k, v in projects.items() if _contains(k, wanted) or _contains(v.get("name"), wanted)}
    if not found:
        return {"error": f"No project matches {wanted!r} in the SL x RP file."}
    if len(found) > 1:
        exact = {k: v for k, v in found.items()
                 if k.lower() == wanted.lower() or str(v.get("name") or "").lower() == wanted.lower()}
        if len(exact) != 1:
            return {"error": "Several projects match; ask which one.",
                    "matches": [f"{k} {v.get('name') or ''}".strip() for k, v in sorted(found.items())][:15]}
        found = exact
    (pid, p), = found.items()
    by_month = p.get("byMonth") or {}
    if not by_month:
        return {"error": f"Nobody is planned on {pid}."}
    clocked = [m for m, c in by_month.items() if c.get("actual")]
    month = str(args.get("month") or "")[:7] or (max(clocked) if clocked else min(by_month))
    if month not in by_month:
        return {"error": f"Nobody is planned on {pid} in {month}.", "monthsWithPeople": sorted(by_month)}
    cell = by_month[month]
    fy = _fy_of(month)
    series = [{"month": m, "actualMonth": c["actual"], "headcount": c["headcount"], "planDays": c["planDays"],
               "planFte": c["planFte"], "actualDays": c["actualDays"], "actualFte": c["actualFte"],
               "daysPerHead": c["daysPerHead"]}
              for m, c in sorted(by_month.items()) if _fy_of(m) == fy]
    done = [s for s in series if s["actualMonth"]]
    people = []
    for person in sorted(cell["people"], key=lambda x: (-(x["planDays"] or 0), x["name"] or "")):
        row = {k: person.get(k) for k in ("position", "band", "employment", "planDays", "planFte", "actualDays",
                                          "actualFte", "clockedDaysAllProjects", "split")}
        people.append(row)        # no names for anyone (10 Nov 2026 review, PDPA): position and grade only
    out = {
        "project": pid, "projectName": p.get("name"), "agency": p.get("agency"), "month": month,
        "monthHasClocking": cell["actual"],
        "thisMonth": {"headcount": cell["headcount"], "planDays": cell["planDays"], "planFte": cell["planFte"],
                      "actualDays": cell["actualDays"], "actualFte": cell["actualFte"],
                      "daysPerHead": cell["daysPerHead"], "peopleWithoutClocking": cell["notClocked"]},
        "fiscalYear": fy,
        "yearToDate": {"months": len(done),
                       "planDays": _r(sum(s["planDays"] for s in done), 1),
                       "actualDays": _r(sum(s["actualDays"] or 0 for s in done), 1)} if done else None,
        "byMonth": series,
        "peopleCount": len(people), "peopleShown": min(len(people), MAX_PEOPLE), "people": people[:MAX_PEOPLE],
        "rule": "1 FTE = 18 man-days a month. Red when a person clocks below 15.3 or above 18 billable days a month "
                "(clockedDaysAllProjects, their whole month).",
        "basis": "HC = people on the project (SL x RP and the clocking); plan = SL x RP man-days; actual = days clocked "
                 + ("to this project in the MSPO clocking export (sandbox: synthetic data)" if roster.get("actualSource")
                    == "mspo" else "from the UR report, split over their projects by plan days when they are on "
                    "more than one (split = true)")
                 + ". planDays 0 with actual days = clocked here without being planned. Months not clocked yet are "
                   "plan only.",
    }
    out["names"] = "Names are never shown: each row is a position and its grade."
    return out
