// src/dashboard/flagRules.ts
// When the dashboard flags a Billable UR in red: below the band's target, or above 100%.
// The targets come with the capacity plan (GET /analysis, settings per fiscal year), so Finance changes them in
// one place (pipeline/plan_settings.py) and this page follows.

import type { CapacityPlan } from "../api/types";

export const UR_MAX = 1; // above 100% is flagged too: more billable days than working days points at a data problem
const FALLBACK_MIN = 0.7; // used only when the plan carries no targets (the sample plan)

// The UR targets per band ("all", "b9".."b3") of the plan's first fiscal year.
export function urTargetsOf(plan: CapacityPlan | null): Record<string, number> {
  const years = Object.keys(plan?.settings ?? {}).sort();
  return years.length ? plan!.settings![years[0]].urTargets : {};
}

// True when a band's billable UR is below its target or above 100%. Use "all" for the total row.
export function isUrFlagged(bandId: string, ur: number, targets: Record<string, number>): boolean {
  const min = targets[bandId] ?? FALLBACK_MIN;
  return ur < min - 1e-9 || ur > UR_MAX + 1e-9;
}
