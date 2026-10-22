"""Settings of the capacity plan, per fiscal year, and currency conversion.

All money in the system is in USD. Values given in another currency (the band day rates are set in SGD)
are converted with the fiscal year's fixed Finance rate, never a market rate, so the same plan always gives
the same numbers.

Per fiscal year (April to March, see fiscal.py):
  sgdPerUsd           Finance's rate: 1 USD = this many SGD. USD = SGD / sgdPerUsd.
  urTargets           Billable UR targets, used in the plan's forecast months ("all" is the total row).
  bandDayRates        day rate per band, in bandDayRatesCurrency. Used for revenue per FTE and resource cost.
  revenuePerMonthUsd  placeholder for the Revenue row, which Finance types in each month.

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
