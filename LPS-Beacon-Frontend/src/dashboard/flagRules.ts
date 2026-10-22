// src/dashboard/flagRules.ts
// When the dashboard flags a Billable UR in red: an ACTUAL month below its target. The "All bands" row is held to
// the overall target (85.4% for FY26), each band to its own. Forecast months use the targets themselves, so they
// are never flagged. The targets come with the capacity plan (GET /analysis, settings per fiscal year), so they
// are changed in one place (pipeline/plan_settings.py) and this page follows.

import type { CapacityPlan } from "../api/types";

const FALLBACK_MIN = 0.7; // used only when the plan carries no targets (the sample plan)

// The UR targets per band ("all", "b9".."b3") of the plan's first fiscal year.
export function urTargetsOf(plan: CapacityPlan | null): Record<string, number> {
  const years = Object.keys(plan?.settings ?? {}).sort();
  return years.length ? plan!.settings![years[0]].urTargets : {};
}

// True when an actual month's billable UR is below the target of its band ("all" for the total row).
export function isUrFlagged(bandId: string, ur: number, targets: Record<string, number>, actual: boolean): boolean {
  if (!actual) return false;
  const min = targets[bandId] ?? FALLBACK_MIN;
  return ur < min - 1e-9;
}
