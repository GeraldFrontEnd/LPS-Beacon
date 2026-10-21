// src/review/ReviewDrawer.tsx
// The review panel of the Upload page.
//  - A bar along the bottom (with an up arrow) shows where the review is. Click it to open the panel.
//  - The panel slides up from the bottom and stops just under the "Upload files" title; the page behind darkens.
//  - It opens by itself whenever the system has something for the user to review.
// The content of each step lives in its own file (ConflictsStep, ForecastStep, MatchingStep).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { CheckIcon, ChevronDownIcon } from "../components/icons";
import ConflictsStep from "./ConflictsStep";
import ForecastStep from "./ForecastStep";
import MatchingStep from "./MatchingStep";
import type { ReviewStage } from "./types";
import { useReview } from "./useReview";

interface ReviewDrawerProps {
  // The element the panel's top edge lines up with (the bottom of the "Upload files" title).
  anchorRef: RefObject<HTMLElement | null>;
}

// The three review steps, in order, for the stepper at the top of the panel.
const STEPPER: { stage: ReviewStage; label: string }[] = [
  { stage: "conflicts", label: "Conflicts" },
  { stage: "forecast", label: "Forecast" },
  { stage: "matching", label: "Matching" },
];


// An up arrow for the closed bar.
function ArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export default function ReviewDrawer({ anchorRef }: ReviewDrawerProps) {
  const review = useReview();
  const { stage, steps, isOpen, setOpen, data, enabled, progress, notices, rejectedFiles, stopMessage, error } = review;
  const navigate = useNavigate();

  // Where the panel's top edge goes: just below the page title. Measured on open and when the window resizes.
  const [top, setTop] = useState(120);
  useLayoutEffect(() => {
    function measure() {
      const el = anchorRef.current;
      if (el) setTop(Math.round(el.getBoundingClientRect().bottom + 8));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchorRef, isOpen]);

  // Escape closes the panel (it can be opened again from the bar at any time).
  // A confirmation dialog on top handles its own Escape, so ignore the key while one is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".dialog-backdrop")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, setOpen]);

  // Move keyboard focus into the panel when it opens, for keyboard and screen reader users.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  const running = steps.find((s) => s.state === "running");
  const waiting = stage === "conflicts" || stage === "forecast" || stage === "matching";

  // The words on the bar.
  let barText: string;
  if (!enabled) barText = "Review is not connected yet. Turn on VITE_USE_SAMPLE_REVIEW to preview it with sample data.";
  else if (stage === "idle") barText = "No review waiting. Upload files to start one.";
  else if (stage === "processing") barText = `${running?.label ?? "Finishing"}…`;
  else if (stage === "conflicts") barText = `Step 1 of 3: ${data?.conflicts.length ?? 0} conflicts need your decision`;
  else if (stage === "forecast") barText = "Step 2 of 3: forecast ready for your review";
  else if (stage === "matching") barText = "Step 3 of 3: matching list ready for your review";
  else if (stage === "done") barText = "Review complete";
  else if (stage === "stopped") barText = `Review stopped: ${stopMessage ?? "the pipeline could not continue"}`;
  else barText = "Review ended: the matching list was rejected";

  const current = stage === "idle" ? -1 : progress;

  return (
    <>
      {/* The bar is always there at the bottom of the page. */}
      <button
        type="button"
        className={`review-bar${waiting ? " attention" : ""}`}
        onClick={() => setOpen(true)}
        disabled={!enabled}
        aria-expanded={isOpen}
        aria-controls="review-panel"
      >
        <span className="review-bar-arrow">
          <ArrowUp />
        </span>
        <span className="review-bar-title">Review</span>
        {stage === "processing" && <span className="status-dot pulsing" aria-hidden="true" />}
        {waiting && <span className="review-bar-badge">Action needed</span>}
        <span className="review-bar-text">{barText}</span>
      </button>

      {/* The dark layer behind the panel. Clicking it closes the panel. */}
      <div className={`review-backdrop${isOpen ? " open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />

      <div
        id="review-panel"
        ref={panelRef}
        className={`review-panel${isOpen ? " open" : ""}`}
        style={{ top }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-hidden={!isOpen}
        tabIndex={-1}
        inert={!isOpen}
      >
        <header className="review-head">
          <h2 id="review-title">Review</h2>
          <ol className="review-stepper" aria-label="Review steps">
            {STEPPER.map((s, i) => (
              <li
                key={s.stage}
                className={i < current ? "done" : i === current ? "current" : ""}
                aria-current={i === current ? "step" : undefined}
              >
                <span className="review-step-dot">{i < current ? <CheckIcon size={12} /> : i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <button type="button" className="review-close" onClick={() => setOpen(false)} aria-label="Close review">
            <ChevronDownIcon size={18} />
          </button>
        </header>

        <div className="review-content">
          {error && (
            <p className="error-banner review-banner" role="alert">
              {error}
            </p>
          )}
          {(rejectedFiles.length > 0 || (notices.length > 0 && waiting)) && stage !== "stopped" && (
            <details className="review-notes">
              <summary>
                {[
                  rejectedFiles.length > 0
                    ? `${rejectedFiles.length} uploaded file${rejectedFiles.length === 1 ? " was" : "s were"} not used`
                    : "",
                  notices.length > 0 && waiting ? `${notices.length} note${notices.length === 1 ? "" : "s"} from the system` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </summary>
              <ul>
                {rejectedFiles.map((f) => (
                  <li key={f.name}>
                    <strong>{f.name}</strong>: {f.reason}
                  </li>
                ))}
                {waiting && notices.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </details>
          )}
          {stage === "idle" && (
            <div className="review-empty">
              <h3>Nothing to review yet</h3>
              <p>
                After you upload files, the system cross-validates them, cleans them and maps position names. Its
                findings show up here for you to check, one step at a time.
              </p>
            </div>
          )}

          {stage === "processing" && (
            <div className="review-processing">
              <ul className="review-checklist">
                {steps.map((s) => (
                  <li key={s.label} className={s.state}>
                    <span className="review-check-icon" aria-hidden="true">
                      {s.state === "done" ? <CheckIcon size={14} /> : s.state === "running" ? <span className="review-spinner" /> : null}
                    </span>
                    {s.label}
                    <span className="visually-hidden">
                      {s.state === "done" ? " (done)" : s.state === "running" ? " (in progress)" : " (waiting)"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="note">You can close this panel. It opens again when there is something to review.</p>
            </div>
          )}

          {stage === "conflicts" && <ConflictsStep />}
          {stage === "forecast" && <ForecastStep />}
          {stage === "matching" && <MatchingStep />}

          {stage === "done" && (
            <div className="review-finish">
              <span className="review-finish-icon success" aria-hidden="true">
                <CheckIcon size={28} />
              </span>
              <h3>Review complete</h3>
              <p>
                The matching list is confirmed and the hiring demand has been worked out from the roles nobody could fill.
                The Analysis and Dashboard pages now include this upload.
              </p>
              <p>Have questions about the resources? Ask the assistant.</p>
              <div className="review-finish-actions">
                <button type="button" className="primary-button" onClick={() => navigate("/")}>
                  Go to Chat
                </button>
                <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {stage === "stopped" && (
            <div className="review-finish">
              <h3>The review could not continue</h3>
              <p>{stopMessage}</p>
              {rejectedFiles.length > 0 && (
                <ul className="review-rejected">
                  {rejectedFiles.map((f) => (
                    <li key={f.name}>
                      <strong>{f.name}</strong>: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="review-finish-actions">
                <button type="button" className="secondary-button" onClick={review.reset}>
                  Clear this review
                </button>
              </div>
            </div>
          )}

          {stage === "ended" && (
            <div className="review-finish">
              <h3>Review ended</h3>
              <p>
                You rejected the matching list, so nothing from this run is used. The Analysis and Dashboard pages are
                unchanged. Upload the files again to start a new review.
              </p>
              <div className="review-finish-actions">
                <button type="button" className="secondary-button" onClick={review.reset}>
                  Clear this review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
