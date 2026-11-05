"""Settings of the capacity plan, per fiscal year, and currency conversion.

All money in the system is in USD. Values given in another currency (the band day rates are set in SGD)
are converted with the fiscal year's fixed Finance rate, never a market rate, so the same plan always gives
the same numbers.

Per fiscal year (April to March, see fiscal.py):
  sgdPerUsd           Finance's rate: 1 USD = this many SGD. USD = SGD / sgdPerUsd.
  urTargets           Billable UR targets, used in the plan's forecast months ("all" is the total row).
  bandDayRates        the rate card (iRate): internal cost rate per band per day, in bandDayRatesCurrency. Used for
                      the resource cost and the weighted average cost per FTE (never to split revenue by band:
                      revenue is not sold by band).
  revenuePerMonthUsd  fallback for the Revenue row when no ABCD report gives the month's revenue.
  target              the "FTE required" calculator's defaults: annual revenue target, GP %, UR, man-days per FTE per
                      month and whether those man-days are billable days. Editable on the page.
  priorYear           last fiscal year's organisation baseline, for "this FY vs last FY", when the system has no
                      files for that year: average headcount and staff cost from the MBR headcount file.

PRODUCTIVITY (one set, not per fiscal year): who counts, and the flag thresholds for agencies.
  The thresholds are a DRAFT: the percentages are placeholders until Ethan sets them (open point 1 of the
  28 Oct change record). Change them here and run {"mode": "capacity_inputs"}.

A fiscal year without settings uses the latest earlier one, and the plan says so (see resolve()).
Change the numbers here and redeploy; there is no settings screen yet.
"""
from __future__ import annotations

import copy

BANDS = ("b9", "b8", "b7", "b6", "b5", "b4", "b3")

FISCAL_YEARS: dict[str, dict] = {
    "FY26": {
        "sgdPerUsd": 1.28,
        "urTargets": {"all": 0.854, "b9": 0.65, "b8": 0.65, "b7": 0.65,
                      "b6": 0.874, "b5": 0.874, "b4": 0.874, "b3": 0.874},
        "bandDayRatesCurrency": "SGD",
        "bandDayRates": {"b9": 1145, "b8": 715, "b7": 562, "b6": 412, "b5": 347, "b4": 274, "b3": 219},
        "revenuePerMonthUsd": 8_000_000,
        # Calculated-FTE-required calculator defaults: $90M is Ethan's example. 1 FTE = 18 man-days a month, and the 18
        # are WORKING days: the company's standard baseline (4 Nov 2026), so UR is applied. The formula itself is being
        # replaced (4 Nov 2026: agreed to be incorrect).
        "target": {"revenueUsd": 90_000_000, "gpPct": 0.27, "billableUr": 0.87, "manDaysPerFte": 18,
                   "manDaysAreBillable": False},
        # FY25 (Apr 2025 - Mar 2026), from HeadCount_File-MBR File.xlsx "FY25/26 HC phasing": FY average headcount
        # and gross staff cost (billable + non-billable, USD).
        "priorYear": {"fiscalYear": "FY25", "averageHeadcount": 561, "staffCostUsd": 45_690_000,
                      "source": "MBR headcount file (FY25/26 HC phasing)"},
    },
}

PRODUCTIVITY = {
    # Which ABCD rows are LPS Singapore delivery (the capacity plan's headcount delivers these).
    "abcdScope": {"Delivery_Region": ["Singapore"]},
    # Agency = the project's End Customer in the ABCD report (else its Customer, else the SL x RP Customer).
    "agencyColumns": ["End_Customer", "Customer"],
    # Headcount base for Revenue / GP per HC (open point 2): "delivery" = the capacity plan's headcount (staff on
    # the UR report). The alternative, all staff on the staff list, is not built.
    "headcountBase": "delivery",
    # Productivity: how far below the company average (Revenue per FTE or GP per FTE, the worse of the two) an
    # agency may be (DRAFT placeholders until Ethan confirms). Utilisation: the clocked-days rule below.
    "flags": {
        "draft": True,
        # GP per FTE is shown for every agency but not in the rule yet: it is a small difference of two big numbers,
        # so a % threshold on it turns most agencies red (24 of 37 on the sandbox data at 20 %). Add "gpPerFte"
        # here if Ethan wants it to trigger flags too.
        "metrics": ["revenuePerFte"],
        "productivity": {"redBelowPct": 0.20, "amberBelowPct": 0.05},
        # 4 Nov 2026 (Derek, from the meeting): 1 person = 18 working days a month, the company's standard baseline
        # (a month averages about 20), at an 85 % UR target, so a head clocking below 15.3 or above 18 billable days a
        # month is red, otherwise green. There is no amber. Applied to a project or agency as the average clocked days
        # per head.
        "utilisation": {"fullMonthManDays": 18, "urTarget": 0.85, "redBelowDays": 15.3, "redAboveDays": 18.0},
        "minFte": 1.0,          # agencies with less delivery FTE than this are listed but not flagged
    },
}

SUPPORTED_CURRENCIES = ("USD", "SGD")


def _fy_number(label: str) -> int:
    return int(label[2:])


def resolve(fy: str) -> dict:
    """The settings for one fiscal year, with day rates converted to USD. Adds "basedOn" when they were
    borrowed from an earlier year (no settings for this one yet)."""
    if fy in FISCAL_YEARS:
        source = fy
    else:
        earlier = [f for f in FISCAL_YEARS if _fy_number(f) < _fy_number(fy)]
        if not earlier:
            raise KeyError(f"no capacity plan settings for {fy} or any earlier fiscal year")
        source = max(earlier, key=_fy_number)
    raw = copy.deepcopy(FISCAL_YEARS[source])
    currency = raw.pop("bandDayRatesCurrency")
    rates = raw.pop("bandDayRates")
    out = {**raw, "fiscalYear": fy,
           "bandDayRatesUsd": {b: round(to_usd(v, currency, raw["sgdPerUsd"]), 2) for b, v in rates.items()},
           "bandDayRatesGiven": {"currency": currency, **rates}}
    if source != fy:
        out["basedOn"] = source
    return out


def to_usd(amount: float, currency: str, sgd_per_usd: float) -> float:
    currency = (currency or "").strip().upper()
    if currency == "USD":
        return float(amount)
    if currency == "SGD":
        return float(amount) / sgd_per_usd
    raise ValueError(f"currency {currency!r} is not supported; use one of {', '.join(SUPPORTED_CURRENCIES)}")
