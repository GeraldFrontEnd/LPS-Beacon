// src/review/MatchingStep.tsx
// The matching step of the review: each demand line on won and ongoing work, and the person (on the bench or rolling
// off) the system matched to it.
//  - Candidates have the same standardised position and are free in time. They are ranked by availability; the band
//    is a secondary check: someone outside the band tolerance is still offered, last, and flagged.
//  - The customer (agency) is shown for each line and person. It is display only, never part of the match.
//  - The user can swap in another candidate, or pick "No match" (the line then counts towards hiring).
//  - Each line is accepted or rejected; a rejected match leaves the line unfilled.
//  - "Publish" sends it on. The panel then stays here: edit and publish again whenever needed.
// "Reject matching list" (before the first publish only) ends the review: nothing from this run is used.

import { useState } from "react";
import { createPortal } from "react-dom";
import Dialog from "../components/Dialog";
import type { DialogOptions } from "../components/Dialog";
import { FORECAST_STEP } from "./flags";
import { formatMonth } from "./reviewLogic";
import type { Decision } from "./types";
import { useReview } from "./useReview";

type Filter = "all" | "pending" | "unfilled";

export default function MatchingStep() {
  const review = useReview();
  const { data, matchLines, assignment, lineDecisions, forecastRejected, published, publishedAt } = review;
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<DialogOptions | null>(null);
  if (!data) return null;

  const decisionOf = (id: string): Decision => lineDecisions[id] ?? "pending";
  // Which line each person is assigned to, so the same person isn't picked twice.
  const takenBy = new Map<string, string>();
  for (const line of matchLines) {
    const pid = assignment[line.id];
    if (pid) takenBy.set(pid, line.id);
  }

  const decided = matchLines.filter((l) => decisionOf(l.id) !== "pending").length;
  const unfilled = matchLines.filter((l) => !assignment[l.id] || decisionOf(l.id) === "rejected").length;
  const fromPipeline = matchLines.filter((l) => l.source === "pipeline").length;

  const shown = matchLines.filter((l) => {
    if (filter === "pending") return decisionOf(l.id) === "pending";
    if (filter === "unfilled") return !assignment[l.id] || decisionOf(l.id) === "rejected";
    return true;
  });

  function askRejectAll() {
    setDialog({
      title: "Reject the matching list?",
      body: "The review ends here and nothing from this run is used. The Analysis and Dashboard pages stay as they are.",
      confirmLabel: "Reject matching list",
      destructive: true,
      onConfirm: () => review.rejectMatching(),
    });
  }

  return (
    <section className="review-step" aria-labelledby="matching-title">
      <div className="review-step-intro">
        <h3 id="matching-title">Redeployment matching</h3>
        {published && (
          <p className="review-published" role="status">
            Published{publishedAt ? ` ${new Date(publishedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.
            The Analysis and Dashboard pages use this matching. Change anything below and click Publish again.
          </p>
        )}
        <p>
          {FORECAST_STEP ? (
            <>
              {matchLines.length} demand lines: {matchLines.length - fromPipeline} from current projects
              {forecastRejected ? " (the forecast was rejected, so no pipeline demand)" : `, ${fromPipeline} from accepted pipeline opportunities`}.
            </>
          ) : (
            <>{matchLines.length} roles on won and ongoing projects, matched to people on the bench or rolling off.</>
          )}{" "}
          Matched by position and availability; the band is a secondary check. Swap a person if needed, then accept or
          reject each match.
        </p>
        <div className="review-bulk">
          <div className="segmented" role="group" aria-label="Show">
            {(
              [
                ["all", `All (${matchLines.length})`],
                ["pending", `Needs a decision (${matchLines.length - decided})`],
                ["unfilled", `No match (${unfilled})`],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "on" : ""}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={review.acceptAllMatches}
            disabled={decided === matchLines.length}
          >
            Accept all remaining
          </button>
        </div>
      </div>

      <table className="review-table match-table">
        <thead>
          <tr>
            <th scope="col">Demand</th>
            <th scope="col">Role needed</th>
            <th scope="col">Matched resource</th>
            <th scope="col">Availability</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => {
            const pid = assignment[line.id];
            const person = pid ? data.people[pid] : null;
            const decision = decisionOf(line.id);
            return (
              <tr key={line.id} className={`decision-${decision}`}>
                <td>
                  <span className={`review-tag source-${line.source === "current" ? "current" : "crm"}`}>
                    {line.source === "current" ? "Current project" : "Pipeline"}
                  </span>
                  <div className="match-title">{line.title}</div>
                  {line.customer && <div className="match-customer">{line.customer}</div>}
                  <div className="note">{line.reference}</div>
                </td>
                <td>
                  {line.position}
                  <div className="note">
                    Band {line.grade} · from {formatMonth(line.start)}
                  </div>
                </td>
                <td>
                  <select
                    className="cell-input wide"
                    value={pid ?? ""}
                    aria-label={`Matched resource for ${line.position}, ${line.title}`}
                    onChange={(e) => review.assign(line.id, e.target.value || null)}
                  >
                    <option value="">No match (hire instead)</option>
                    {line.candidates.map((cid, rank) => {
                      const c = data.people[cid];
                      if (!c) return null;
                      const elsewhere = takenBy.get(cid);
                      const outsideBand = line.bandOk?.[cid] === false;
                      return (
                        <option key={cid} value={cid} disabled={elsewhere !== undefined && elsewhere !== line.id}>
                          {rank + 1}. {c.label} · Band {c.grade}
                          {outsideBand ? " (outside band)" : ""}
                          {elsewhere && elsewhere !== line.id ? " (matched to another line)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {person ? (
                    <div className="note">
                      {person.position} · now on {person.currentProject}
                      {person.currentCustomer ? ` (${person.currentCustomer})` : ""}
                      {pid && line.bandOk?.[pid] === false && (
                        <span className="band-flag"> · Band {person.grade} vs {line.grade} needed: check</span>
                      )}
                    </div>
                  ) : (
                    <div className="note">{line.candidates.length === 0 ? "Nobody on the bench or rolling off with this position" : "Left unfilled"}</div>
                  )}
                </td>
                <td>
                  {person ? (
                    <>
                      {person.status}
                      <div className="note">from {formatMonth(person.availableFrom)}</div>
                    </>
                  ) : (
                    <span className="note">–</span>
                  )}
                </td>
                <td>
                  <div className="opp-decision" role="group" aria-label={`Decision for ${line.position}, ${line.title}`}>
                    <button
                      type="button"
                      className={`decision-button accept${decision === "accepted" ? " on" : ""}`}
                      aria-pressed={decision === "accepted"}
                      onClick={() => review.setLineDecision(line.id, decision === "accepted" ? "pending" : "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={`decision-button reject${decision === "rejected" ? " on" : ""}`}
                      aria-pressed={decision === "rejected"}
                      onClick={() => review.setLineDecision(line.id, decision === "rejected" ? "pending" : "rejected")}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length === 0 && <p className="note review-none">Nothing to show with this filter.</p>}

      <footer className="review-foot">
        <p className="note" aria-live="polite">
          {decided} of {matchLines.length} decided
        </p>
        <div className="review-foot-actions">
          {!published && (
            <button type="button" className="secondary-button danger" onClick={askRejectAll}>
              Reject matching list
            </button>
          )}
          {FORECAST_STEP && !published && (
            <button type="button" className="secondary-button" onClick={() => review.goToStep("forecast")}>
              Change forecast
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={decided < matchLines.length}
            onClick={review.confirmMatching}
          >
            {published ? "Publish again" : "Publish"}
          </button>
        </div>
      </footer>

      {/* Rendered on <body>: the sliding panel would otherwise trap the dialog inside itself. */}
      {dialog && createPortal(<Dialog {...dialog} onClose={() => setDialog(null)} />, document.body)}
    </section>
  );
}
