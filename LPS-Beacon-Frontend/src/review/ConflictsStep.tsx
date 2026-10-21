// src/review/ConflictsStep.tsx
// Step 1 of the review: the same record has different values in two files.
// The user picks the value that is the source of truth. The other values are excluded from processing
// (they stay in the uploaded file, so the activity log can still show what was chosen against).

import { useReview } from "./useReview";

export default function ConflictsStep() {
  const { data, conflictChoices, chooseConflict, confirmConflicts } = useReview();
  if (!data) return null;

  const conflicts = data.conflicts;
  const decided = conflicts.filter((c) => conflictChoices[c.id]).length;

  // Picks the same file's value for every conflict that file is part of.
  function pickFileForAll(file: string) {
    for (const c of conflicts) {
      const option = c.options.find((o) => o.file === file);
      if (option) chooseConflict(c.id, option.id);
    }
  }

  const files = [...new Set(conflicts.flatMap((c) => c.options.map((o) => o.file)))];

  return (
    <section className="review-step" aria-labelledby="conflicts-title">
      <div className="review-step-intro">
        <h3 id="conflicts-title">Conflicts between files</h3>
        <p>
          These records appear in more than one file with different values. Pick the value that is correct. The other
          value is left out of cleaning, forecasting and matching.
        </p>
        <div className="review-bulk">
          <span className="note">Use one file for all:</span>
          {files.map((f) => (
            <button key={f} type="button" className="secondary-button" onClick={() => pickFileForAll(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="conflict-list">
        {conflicts.map((c) => (
          <li key={c.id} className="conflict-card">
            <div className="conflict-head">
              <span className="review-tag">{c.entity}</span>
              <strong>{c.label}</strong>
              <span className="note">
                {c.key} · {c.field}
              </span>
            </div>
            <fieldset className="conflict-options">
              <legend className="visually-hidden">
                Which {c.field} is correct for {c.label}?
              </legend>
              {c.options.map((o) => (
                <label key={o.id} className={`conflict-option${conflictChoices[c.id] === o.id ? " chosen" : ""}`}>
                  <input
                    type="radio"
                    name={`conflict-${c.id}`}
                    checked={conflictChoices[c.id] === o.id}
                    onChange={() => chooseConflict(c.id, o.id)}
                  />
                  <span className="conflict-value">{o.value}</span>
                  <span className="conflict-source">
                    {o.file}
                    <br />
                    <span className="note">{o.location}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>

      <footer className="review-foot">
        <p className="note" aria-live="polite">
          {decided} of {conflicts.length} decided
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={decided < conflicts.length}
          onClick={confirmConflicts}
        >
          Confirm and run forecast
        </button>
      </footer>
    </section>
  );
}
