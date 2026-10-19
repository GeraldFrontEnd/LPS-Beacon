// src/dashboard/flagRules.ts
// The limits the dashboard uses to flag numbers in red. Change the numbers here only.

// Billable UR % outside [min, max] turns the heat map cell red. Fractions: 0.7 = 70%, 1 = 100%.
// PLACEHOLDER values: every band uses 70% to 100% until the real targets are set.
export const UR_LIMITS: Record<string, { min: number; max: number }> = {
  all: { min: 0.7, max: 1 }, // the "All bands" row
  b9: { min: 0.7, max: 1 },
  b8: { min: 0.7, max: 1 },
  b7: { min: 0.7, max: 1 },
  b6: { min: 0.7, max: 1 },
  b5: { min: 0.7, max: 1 },
  b4: { min: 0.7, max: 1 },
  b3: { min: 0.7, max: 1 },
};

// True when a band's billable UR is outside its limits. Use "all" for the total row.
export function isUrFlagged(bandId: string, ur: number): boolean {
  const limits = UR_LIMITS[bandId];
  return !!limits && (ur < limits.min || ur > limits.max);
}
