// src/review/ForecastStep.tsx
// Step 2 of the review: the resources each pipeline opportunity needs.
//  - Each opportunity is accepted or rejected on its own.
//  - Opportunities with their own resource plan (CRM match) can be accepted all at once.
//  - Opportunities copied from a similar past project are a recommendation only, so they must be accepted one by one.
//  - Inside an opportunity, every resource field can be edited, and a resource can be removed.
// "Reject forecast" leaves the whole pipeline out; matching then runs on current project demand only.

import { useState } from "react";
import { createPortal } from "react-dom";
import Dialog from "../components/Dialog";
import type { DialogOptions } from "../components/Dialog";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons";
import { editedResource, formatMonth, formatUsd, resourceProblem } from "./reviewLogic";
import type { Decision, EditableResourceField, ForecastSource, Opportunity } from "./types";
import { useReview } from "./useReview";

const SOURCE_LABEL: Record<ForecastSource, string> = {
  crm: "From CRM match",
  similar: "Similar past project",
  manual: "Needs manual input",
};

const BANDS = [3, 4, 5, 6, 7, 8, 9];

export default function ForecastStep() {
  const review = useReview();
  const { data, oppDecisions, edits, removed } = review;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogOptions | null>(null);
  if (!data) return null;

  const opps = data.opportunities;
  const decisionOf = (o: Opportunity): Decision => oppDecisions[o.id] ?? "pending";

  // An opportunity can't be accepted while one of its kept resources has a wrong value, or when it has none.
  function problemsOf(o: Opportunity): string[] {
    return o.resources
      .filter((r) => !removed[r.id])
      .map((r) => resourceProblem(editedResource(r, edits[r.id])))
      .filter((p): p is string => p !== null);
  }
  const keptCount = (o: Opportunity) => o.resources.filter((r) => !removed[r.id]).length;

  const decided = opps.filter((o) => decisionOf(o) !== "pending").length;
  const blocked = opps.some((o) => decisionOf(o) === "accepted" && (problemsOf(o).length > 0 || keptCount(o) === 0));
  const pendingCrm = opps.filter((o) => o.source === "crm" && decisionOf(o) === "pending").length;
  const counts = {
    crm: opps.filter((o) => o.source === "crm").length,
    similar: opps.filter((o) => o.source === "similar").length,
    manual: opps.filter((o) => o.source === "manual").length,
  };

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function edit(resourceId: string, field: EditableResourceField, raw: string) {
    const value = field === "grade" || field === "fte" ? Number(raw) : raw;
    review.editResource(resourceId, { [field]: value });
  }

  function askRejectAll() {
    setDialog({
      title: "Reject the whole forecast?",
      body: "None of the pipeline opportunities will be used. Matching still runs on current project demand.",
      confirmLabel: "Reject forecast",
      destructive: true,
      onConfirm: () => review.rejectForecast(),
    });
  }

  return (
    <section className="review-step" aria-labelledby="forecast-title">
      <div className="review-step-intro">
        <h3 id="forecast-title">Forecast for pipeline opportunities</h3>
        <p>
          {counts.crm} from their own resource plan (CRM match), {counts.similar} based on a similar past project,{" "}
          {counts.manual} with no plan. Accept or reject each opportunity. Open one to edit or remove its resources.
        </p>
        <div className="review-bulk">
          <button type="button" className="secondary-button" onClick={review.acceptAllCrm} disabled={pendingCrm === 0}>
            Accept all CRM matches{pendingCrm > 0 ? ` (${pendingCrm})` : ""}
          </button>
          <button type="button" className="secondary-button" onClick={review.leaveOutUndecided} disabled={decided === opps.length}>
            Leave out all undecided
          </button>
          <span className="note">Opportunities based on a similar past project must be accepted one by one.</span>
        </div>
      </div>

      <ul className="opp-list">
        {opps.map((o) => {
          const decision = decisionOf(o);
          const isOpen = expanded[o.id] ?? false;
          const problems = problemsOf(o);
          const kept = keptCount(o);
          const totalFte = o.resources
            .filter((r) => !removed[r.id])
            .reduce((sum, r) => sum + editedResource(r, edits[r.id]).fte, 0);
          const editedHere = o.resources.some((r) => edits[r.id] || removed[r.id]);
          const canAccept = o.source !== "manual" && kept > 0 && problems.length === 0;

          return (
            <li key={o.id} className={`opp-card decision-${decision}`}>
              <div className="opp-head">
                <button
                  type="button"
                  className="opp-toggle"
                  onClick={() => toggle(o.id)}
                  aria-expanded={isOpen}
                  aria-controls={`opp-body-${o.id}`}
                  disabled={o.source === "manual"}
                >
                  {o.source !== "manual" && (isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />)}
                  <span className="opp-name">{o.name}</span>
                </button>
                <span className={`review-tag source-${o.source}`}>{SOURCE_LABEL[o.source]}</span>
                {editedHere && <span className="review-tag edited">Edited</span>}
                {problems.length > 0 && (
                  <span className="review-tag problem">
                    {problems.length} value{problems.length === 1 ? "" : "s"} to fix
                  </span>
                )}
                <div className="opp-decision" role="group" aria-label={`Decision for ${o.name}`}>
                  <button
                    type="button"
                    className={`decision-button accept${decision === "accepted" ? " on" : ""}`}
                    aria-pressed={decision === "accepted"}
                    disabled={!canAccept}
                    onClick={() => review.setOppDecision(o.id, decision === "accepted" ? "pending" : "accepted")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className={`decision-button reject${decision === "rejected" ? " on" : ""}`}
                    aria-pressed={decision === "rejected"}
                    onClick={() => review.setOppDecision(o.id, decision === "rejected" ? "pending" : "rejected")}
                  >
                    {o.source === "manual" ? "Leave out" : "Reject"}
                  </button>
                </div>
              </div>

              <dl className="opp-facts">
                <div>
                  <dt>CRM ID</dt>
                  <dd>{o.crmId}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{o.customer}</dd>
                </div>
                <div>
                  <dt>Stage</dt>
                  <dd>
                    {o.stage} · {Math.round(o.probability * 100)}%
                  </dd>
                </div>
                <div>
                  <dt>TCV</dt>
                  <dd>{formatUsd(o.tcvUsd)}</dd>
                </div>
                <div>
                  <dt>Expected close</dt>
                  <dd>{formatMonth(o.expectedClose)}</dd>
                </div>
                <div>
                  <dt>Revenue months</dt>
                  <dd>
                    {formatMonth(o.start)} to {formatMonth(o.end)}
                  </dd>
                </div>
                <div>
                  <dt>Offering</dt>
                  <dd>{o.offering}</dd>
                </div>
                <div>
                  <dt>Resources</dt>
                  <dd>
                    {kept} · {totalFte.toFixed(1)} FTE/month
                  </dd>
                </div>
              </dl>

              {o.source === "similar" && o.basis && (
                <p className="review-warning">
                  <strong>Recommendation only.</strong> No resource plan exists for this opportunity, so these resources
                  are copied from the past project <strong>{o.basis.projectName}</strong> ({o.basis.projectId}, TCV{" "}
                  {formatUsd(o.basis.tcvUsd)}, {o.basis.offering})
                  {o.basis.shiftedMonths ? `, with its months moved to start in ${formatMonth(o.start)}` : ""}.
                  {o.basis.reasons && o.basis.reasons.length > 0 ? ` Why this project: ${o.basis.reasons.join(", ")}.` : ""}{" "}
                  Check every resource before accepting.
                </p>
              )}
              {o.source === "manual" && (
                <p className="review-warning muted">
                  No resource plan in SL x RP and no similar past project. Entering resources by hand comes later; leave
                  this opportunity out for now.
                </p>
              )}
              {decision === "accepted" && kept === 0 && (
                <p className="field-error">Every resource was removed. Reject the opportunity instead.</p>
              )}

              {isOpen && o.resources.length > 0 && (
                <div className="opp-body" id={`opp-body-${o.id}`}>
                  <table className="review-table">
                    <thead>
                      <tr>
                        <th scope="col">Position</th>
                        <th scope="col">Band</th>
                        <th scope="col">Start</th>
                        <th scope="col">End</th>
                        <th scope="col">FTE/month</th>
                        <th scope="col">Man-days</th>
                        <th scope="col">Source row</th>
                        <th scope="col">
                          <span className="visually-hidden">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.resources.map((original, idx) => {
                        const r = editedResource(original, edits[original.id]);
                        const isRemoved = removed[original.id] ?? false;
                        const changed = (f: EditableResourceField) =>
                          edits[original.id]?.[f] !== undefined && edits[original.id]?.[f] !== original[f];
                        const problem = isRemoved ? null : resourceProblem(r);
                        const dupIndex = original.duplicateOf
                          ? o.resources.findIndex((x) => x.id === original.duplicateOf) + 1
                          : 0;
                        const label = `${r.position} (row ${idx + 1})`;
                        return (
                          <tr key={original.id} className={isRemoved ? "removed" : ""}>
                            <td>
                              <input
                                className={`cell-input wide${changed("position") ? " changed" : ""}`}
                                value={r.position}
                                disabled={isRemoved}
                                aria-label={`Position, ${label}`}
                                onChange={(e) => edit(original.id, "position", e.target.value)}
                              />
                              {dupIndex > 0 && !isRemoved && (
                                <span className="review-tag duplicate">Likely duplicate of row {dupIndex}</span>
                              )}
                              {original.alreadyInQuoteLines && !isRemoved && (
                                <span className="review-tag duplicate">
                                  Already in the quote line file ({original.alreadyInQuoteLines})
                                </span>
                              )}
                              {problem && <span className="field-error">{problem}</span>}
                            </td>
                            <td>
                              <select
                                className={`cell-input${changed("grade") ? " changed" : ""}`}
                                value={r.grade}
                                disabled={isRemoved}
                                aria-label={`Band, ${label}`}
                                onChange={(e) => edit(original.id, "grade", e.target.value)}
                              >
                                {BANDS.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="month"
                                className={`cell-input${changed("start") ? " changed" : ""}`}
                                value={r.start}
                                disabled={isRemoved}
                                aria-label={`Start month, ${label}`}
                                onChange={(e) => edit(original.id, "start", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="month"
                                className={`cell-input${changed("end") ? " changed" : ""}`}
                                value={r.end}
                                disabled={isRemoved}
                                aria-label={`End month, ${label}`}
                                onChange={(e) => edit(original.id, "end", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                step={0.05}
                                className={`cell-input narrow${changed("fte") ? " changed" : ""}`}
                                value={r.fte}
                                disabled={isRemoved}
                                aria-label={`FTE per month, ${label}`}
                                onChange={(e) => edit(original.id, "fte", e.target.value)}
                              />
                            </td>
                            <td className="num">{original.manDays}</td>
                            <td className="note nowrap">{original.sourceId}</td>
                            <td>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => review.setRemoved(original.id, !isRemoved)}
                              >
                                {isRemoved ? "Restore" : "Remove"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="review-foot">
        <p className="note" aria-live="polite">
          {decided} of {opps.length} decided
          {blocked ? " · fix the highlighted values first" : ""}
        </p>
        <div className="review-foot-actions">
          <button type="button" className="secondary-button danger" onClick={askRejectAll}>
            Reject forecast
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={decided < opps.length || blocked}
            onClick={review.confirmForecast}
          >
            Confirm and run matching
          </button>
        </div>
      </footer>

      {/* Rendered on <body>: the sliding panel would otherwise trap the dialog inside itself. */}
      {dialog && createPortal(<Dialog {...dialog} onClose={() => setDialog(null)} />, document.body)}
    </section>
  );
}
