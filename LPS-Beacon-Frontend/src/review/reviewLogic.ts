// src/review/reviewLogic.ts
// Plain functions used by the review panel: building the matching list, the first assignment, and checks.
// No React here, so these are easy to test and will move to the backend later.

import type {
  CurrentDemand,
  ForecastResource,
  MatchLine,
  Opportunity,
  ResourceEdit,
  ReviewData,
} from "./types";

// A resource with the user's edits applied.
export function editedResource(resource: ForecastResource, edit: ResourceEdit | undefined): ForecastResource {
  return edit ? { ...resource, ...edit } : resource;
}

// What is wrong with a resource's values, or null when it is fine.
export function resourceProblem(r: ForecastResource): string | null {
  if (!r.position.trim()) return "Position is empty.";
  if (!/^\d{4}-\d{2}$/.test(r.start) || !/^\d{4}-\d{2}$/.test(r.end)) return "Pick a start and end month.";
  if (r.end < r.start) return "End month is before the start month.";
  if (!(r.fte > 0)) return "FTE must be more than 0.";
  return null;
}

// Builds the matching list. Current project demand is always in it. Pipeline resources are only added
// for opportunities the user accepted (none when the whole forecast was rejected), without removed rows.
export function buildMatchLines(
  data: ReviewData,
  acceptedOpportunities: Opportunity[],
  edits: Record<string, ResourceEdit>,
  removed: Record<string, boolean>
): MatchLine[] {
  const current = data.currentDemand.map(
    (d: CurrentDemand): MatchLine => ({
      id: d.id,
      source: "current",
      title: d.projectName,
      reference: d.quoteLine,
      position: d.position,
      grade: d.grade,
      start: d.start,
      candidates: d.candidates,
    })
  );

  const pipeline: MatchLine[] = [];
  for (const opp of acceptedOpportunities) {
    for (const original of opp.resources) {
      if (removed[original.id]) continue;
      const r = editedResource(original, edits[original.id]);
      // A changed band can rule people out: keep only candidates within one band of the (edited) grade.
      const candidates = (data.pipelineCandidates[original.id] ?? []).filter((pid) => {
        const p = data.people[pid];
        return p !== undefined && Math.abs(p.grade - r.grade) <= 1;
      });
      pipeline.push({
        id: `M-${original.id}`,
        source: "pipeline",
        title: opp.name,
        reference: opp.crmId,
        position: r.position,
        grade: r.grade,
        start: r.start,
        candidates,
      });
    }
  }

  // Current projects first (they are committed work), then pipeline; earliest need first within each.
  // The first assignment goes down this list, so earlier lines get the first pick.
  const byStart = (a: MatchLine, b: MatchLine) => (a.start ?? "9999").localeCompare(b.start ?? "9999");
  return [...current.sort(byStart), ...pipeline.sort(byStart)];
}

// The first assignment: each line takes its best candidate that no earlier line has taken.
// A line with no free candidate gets null, which means "hire".
export function firstAssignment(lines: MatchLine[]): Record<string, string | null> {
  const taken = new Set<string>();
  const result: Record<string, string | null> = {};
  for (const line of lines) {
    const pick = line.candidates.find((pid) => !taken.has(pid)) ?? null;
    if (pick) taken.add(pick);
    result[line.id] = pick;
  }
  return result;
}

// "2026-10" -> "Oct 2026". Anything else is shown as it is.
export function formatMonth(ym: string | null | undefined): string {
  if (!ym) return "–";
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

// 1234567 -> "$1.23M", 45678 -> "$45.7K".
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
