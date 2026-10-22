// src/review/MatchBasis.tsx
// Why an opportunity was based on a particular past project: the two side by side (name, TCV, period, offering) with how alike each criterion is, so an approver can see the reason for the match before accepting it.

import { formatMonth, formatUsd } from "./reviewLogic";
import type { Opportunity, SimilarBasis } from "./types";

type Level = "good" | "fair" | "weak" | "unknown";

const CRITERION_LABEL: Record<string, string> = { tcv: "TCV", offering: "offering", duration: "length", name: "name" };

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function levelOf(value: number | null | undefined): Level {
  if (value === null || value === undefined) return "unknown";
  if (value >= 0.8) return "good";
  if (value >= 0.5) return "fair";
  return "weak";
}

function period(start: string | null, end: string | null, months: number | null | undefined): string {
  const span = `${formatMonth(start)} to ${formatMonth(end)}`;
  return months ? `${span} (${months} month${months === 1 ? "" : "s"})` : span;
}

function MatchCell({ level, text }: { level: Level; text: string }) {
  return <td className={`basis-cell basis-${level}`}>{text}</td>;
}

export default function MatchBasis({ opp, basis }: { opp: Opportunity; basis: SimilarBasis }) {
  const m = basis.match;
  const months = basis.shiftedMonths
    ? ` Its months were moved by ${basis.shiftedMonths} to start in ${formatMonth(opp.start)}.`
    : "";

  return (
    <div className="review-warning basis-panel">
      <p>
        <strong>Recommendation only.</strong> No resource plan exists for this opportunity, so its resources are copied
        from the past project below.{months} Check every resource before accepting.
      </p>

      {m ? (
        <>
          <div className="basis-table-wrap">
            <table className="review-table basis-table" aria-label="This opportunity compared with the past project it is based on">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Criterion</span>
                  </th>
                  <th scope="col">This opportunity</th>
                  <th scope="col">Past project ({basis.projectId})</th>
                  <th scope="col">Match</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Name</th>
                  <td>{opp.name}</td>
                  <td>{basis.projectName}</td>
                  <MatchCell level={levelOf(m.name)} text={m.name > 0 ? `${pct(m.name)} of words shared` : "No words in common"} />
                </tr>
                <tr>
                  <th scope="row">TCV</th>
                  <td>{formatUsd(opp.tcvUsd)}</td>
                  <td>{formatUsd(basis.tcvUsd)}</td>
                  <MatchCell level={levelOf(m.tcv)} text={`${pct(m.tcv)} alike`} />
                </tr>
                <tr>
                  <th scope="row">Period</th>
                  <td>{period(opp.start, opp.end, basis.opportunityMonths)}</td>
                  <td>{period(basis.start, basis.end, basis.durationMonths)}</td>
                  <MatchCell
                    level={m.duration > 0 ? levelOf(m.duration) : "unknown"}
                    text={m.duration > 0 ? `Length ${pct(m.duration)} alike` : "Length not known"}
                  />
                </tr>
                <tr>
                  <th scope="row">Offering</th>
                  <td>{opp.offering || "–"}</td>
                  <td>{basis.offering || "–"}</td>
                  <MatchCell level={m.offering ? "good" : "weak"} text={m.offering ? "Same" : "Different"} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="basis-footnote">
            {basis.score !== undefined && (
              <>
                Overall similarity <strong>{pct(basis.score)}</strong>
                {basis.threshold !== undefined ? ` (a match needs at least ${pct(basis.threshold)})` : ""}.{" "}
              </>
            )}
            {basis.weights && (
              <>
                Weighting:{" "}
                {Object.entries(basis.weights)
                  .map(([k, w]) => `${CRITERION_LABEL[k] ?? k} ${pct(w)}`)
                  .join(", ")}
.
              </>
            )}
          </p>
        </>
      ) : (
        // Reviews prepared before the comparison existed only carry a short list of reasons.
        <p>
          Past project <strong>{basis.projectName}</strong> ({basis.projectId}, TCV {formatUsd(basis.tcvUsd)},{" "}
          {basis.offering}).
          {basis.reasons && basis.reasons.length > 0 ? ` Why this project: ${basis.reasons.join(", ")}.` : ""}
        </p>
      )}
    </div>
  );
}
