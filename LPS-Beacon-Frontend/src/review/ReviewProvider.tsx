// src/review/ReviewProvider.tsx
// Holds the review run ABOVE the pages, like UploadProvider, so a review in progress survives leaving the
// Upload page. UploadProvider calls startProcessing() when an upload finishes; the review panel calls
// startStoredReview() to review the data already uploaded without uploading it again.
//
// Two modes:
//  - pipeline (default): the forecast pipeline Lambda does the work. After an upload it cleans the files and pauses
//    at each review step; this provider polls the upload's status, loads each step's findings and sends the user's
//    decisions back (src/api/client.ts: getUploadStatus, getReviewStep, postReviewDecisions).
//  - sample (VITE_USE_SAMPLE_REVIEW=true or VITE_USE_MOCK=true): no backend. Each step waits a moment and the
//    findings come from sampleReviewData.ts. For demos and for working on the screens.
// The screens are the same in both modes.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getReviewStep, getUploadStatus, postReviewDecisions, startStoredReview as requestStoredReview } from "../api/client";
import type { PipelineUploadStatus, ReviewStep, UploadBatch } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { ReviewContext } from "./reviewContext";
import type { ReviewContextValue } from "./reviewContext";
import { buildMatchLines, editedResource, firstAssignment, resourceProblem } from "./reviewLogic";
import { SAMPLE_REVIEW } from "./sampleReviewData";
import type {
  Conflict,
  Decision,
  MatchLine,
  Opportunity,
  Person,
  ProcessingStep,
  RejectedFile,
  ResourceEdit,
  ReviewData,
  ReviewEvent,
  ReviewStage,
} from "./types";

const SAMPLE_MODE =
  import.meta.env.VITE_USE_SAMPLE_REVIEW === "true" || import.meta.env.VITE_USE_MOCK === "true";

// Sample mode: how long each simulated processing step takes, in milliseconds.
const STEP_MS = 1100;
// Pipeline mode: how often the upload's status is checked while the pipeline works.
const POLL_MS = 3000;

// The processing steps before each review stage (sample mode).
const STEPS_AFTER_UPLOAD = [
  "Cross-validating the uploaded files",
  "Cleaning and transforming the files",
  "Mapping position names to the standard list",
];
const STEPS_AFTER_CONFLICTS = [
  "Excluding the values you did not choose",
  "Forecasting resource needs for pipeline opportunities",
];
const STEPS_AFTER_FORECAST = ["Calculating each resource's free capacity", "Matching demand to available resources"];
const STEPS_AFTER_MATCHING = [
  "Calculating hiring demand from unfilled roles",
  "Updating the Analysis and Dashboard pages",
];

// Which review step comes at which point of the stepper.
const STEP_PROGRESS: Record<ReviewStep, number> = { conflicts: 0, forecast: 1, matching: 2 };

// What each review step's findings look like when they come from the pipeline.
interface ConflictsPayload {
  conflicts: Conflict[];
}
interface ForecastPayload {
  opportunities: Opportunity[];
  notes?: string[];
}
interface MatchingPayload {
  lines: MatchLine[];
  people: Record<string, Person>;
  assignment: Record<string, string | null>;
  notes?: string[];
}

const EMPTY_DATA: ReviewData = {
  sourceFiles: [],
  conflicts: [],
  opportunities: [],
  currentDemand: [],
  pipelineCandidates: {},
  people: {},
};

interface ReviewProviderProps {
  children: ReactNode;
}

function ReviewState({ children }: ReviewProviderProps) {
  const { user, token } = useAuth();

  const [stage, setStage] = useState<ReviewStage>("idle");
  const [steps, setSteps] = useState<ProcessingStep[]>([]);
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<ReviewData | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedFile[]>([]);
  const [stopMessage, setStopMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false); // a review of the stored data is being requested

  const [conflictChoices, setConflictChoices] = useState<Record<string, string>>({});
  const [oppDecisions, setOppDecisions] = useState<Record<string, Decision>>({});
  const [edits, setEdits] = useState<Record<string, ResourceEdit>>({});
  const [removed, setRemovedMap] = useState<Record<string, boolean>>({});
  const [forecastRejected, setForecastRejected] = useState(false);

  const [matchLines, setMatchLines] = useState<MatchLine[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string | null>>({});
  const [lineDecisions, setLineDecisions] = useState<Record<string, Decision>>({});

  const [events, setEvents] = useState<ReviewEvent[]>([]);

  // Pending timers (sample steps and status polls), so a reset or signing out can stop them.
  const timers = useRef<number[]>([]);
  // Pipeline mode: the upload under review, and the step whose decisions were just sent (so the poll doesn't
  // show that step again in the moment before the pipeline picks the decisions up).
  const batchRef = useRef<UploadBatch | null>(null);
  const sentStep = useRef<ReviewStep | null>(null);
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  function later(fn: () => void, ms: number) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function log(action: string, detail: string) {
    const event: ReviewEvent = {
      at: new Date().toISOString(),
      user: user?.name || user?.email || "Unknown user",
      action,
      detail,
    };
    setEvents((prev) => [...prev, event]);
  }

  // Moves to a stage the user has to act on, and opens the panel so they see it.
  function arrive(next: ReviewStage) {
    setStage(next);
    setOpen(true);
  }

  // ---- Sample mode: a checklist ticked off by timers ----
  function runSteps(labels: string[], nextProgress: number, onDone: () => void) {
    clearTimers();
    setProgress(nextProgress);
    setStage("processing");
    setSteps(labels.map((label, i) => ({ label, state: i === 0 ? "running" : "waiting" })));
    labels.forEach((_, i) => {
      later(() => {
        setSteps(labels.map((label, j) => ({ label, state: j <= i ? "done" : j === i + 1 ? "running" : "waiting" })));
        if (i === labels.length - 1) onDone();
      }, STEP_MS * (i + 1));
    });
  }

  // ---- Pipeline mode: follow the upload's status ----

  // The checklist while the pipeline works: one line per file, then what the run is doing.
  function showStatus(status: PipelineUploadStatus) {
    const stored = status.source === "stored";
    const fileSteps: ProcessingStep[] = status.files.map((f) => ({
      label:
        f.status === "quarantined"
          ? `${f.name}: not used`
          : stored
            ? `${f.name}: already uploaded${f.cleanedAt ? ` (${formatStamp(f.cleanedAt)})` : ""}`
            : `${f.name}: checked and cleaned`,
      state: "done",
    }));
    const running = status.run.state === "waiting_for_files" || status.run.state === "running";
    const runLabel = status.run.message ? capitalise(status.run.message) : "Processing the upload";
    setSteps(running ? [...fileSteps, { label: runLabel, state: "running" }] : fileSteps);
    setRejectedFiles(
      status.files
        .filter((f) => f.status === "quarantined")
        .map((f) => ({ name: f.name, reason: f.reason || "not a file the pipeline understands" }))
    );
  }

  async function loadStep(step: ReviewStep) {
    const batch = batchRef.current;
    if (!batch) return;
    const auth = tokenRef.current ?? undefined;
    if (step === "conflicts") {
      const p = await getReviewStep<ConflictsPayload>(batch, step, auth);
      setData((prev) => ({ ...(prev ?? EMPTY_DATA), conflicts: p.conflicts }));
      setNotices([]);
    } else if (step === "forecast") {
      const p = await getReviewStep<ForecastPayload>(batch, step, auth);
      setData((prev) => ({ ...(prev ?? EMPTY_DATA), opportunities: p.opportunities }));
      setNotices(p.notes ?? []);
    } else {
      const p = await getReviewStep<MatchingPayload>(batch, step, auth);
      setData((prev) => ({ ...(prev ?? EMPTY_DATA), people: p.people }));
      setMatchLines(p.lines);
      setAssignment(p.assignment);
      setLineDecisions({});
      setNotices(p.notes ?? []);
    }
    setProgress(STEP_PROGRESS[step]);
    arrive(step);
  }

  async function poll() {
    const batch = batchRef.current;
    if (!batch) return;
    try {
      const status = await getUploadStatus(batch, tokenRef.current ?? undefined);
      if (batchRef.current !== batch) return; // a newer upload replaced this one meanwhile
      showStatus(status);
      const { state, step, message } = status.run;
      if (state === "awaiting_review" && step && step !== sentStep.current) {
        sentStep.current = null;
        await loadStep(step);
        return;
      }
      if (state === "published") {
        setProgress(3);
        arrive("done");
        return;
      }
      if (state === "ended") {
        setProgress(3);
        arrive("ended");
        return;
      }
      if (state === "failed" || state === "not_run" || state === "waiting_for_inputs" || state === "disabled") {
        setStopMessage(message || "The pipeline stopped.");
        arrive("stopped");
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the upload's progress.");
    }
    later(() => void poll(), POLL_MS);
  }

  function followPipeline(nextProgress: number) {
    clearTimers();
    setError(null);
    setProgress(nextProgress);
    setStage("processing");
    setSteps((prev) => prev.filter((s) => s.state === "done"));
    later(() => void poll(), 1000);
  }

  // Sends one step's decisions, then follows the pipeline to the next step.
  async function send(step: ReviewStep, decisions: object, nextProgress: number) {
    const batch = batchRef.current;
    if (!batch) return;
    setError(null);
    try {
      await postReviewDecisions(batch, step, decisions, tokenRef.current ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your decisions.");
      return;
    }
    sentStep.current = step;
    followPipeline(nextProgress);
  }

  // Forgets every decision of the previous run, so a new one starts clean.
  function clearRun() {
    clearTimers();
    setConflictChoices({});
    setOppDecisions({});
    setEdits({});
    setRemovedMap({});
    setForecastRejected(false);
    setMatchLines([]);
    setAssignment({});
    setLineDecisions({});
    setNotices([]);
    setRejectedFiles([]);
    setStopMessage(null);
    setError(null);
  }

  // Sample mode: the same sample review, whether it came from an upload or the stored data.
  function startSample(firstSteps: string[]) {
    setData(SAMPLE_REVIEW);
    runSteps(firstSteps, 0, () => {
      if (SAMPLE_REVIEW.conflicts.length > 0) arrive("conflicts");
      else runSteps(STEPS_AFTER_CONFLICTS, 1, () => arrive("forecast"));
    });
  }

  // ---- Start: called by UploadProvider after files were uploaded ----
  function startProcessing(fileNames: string[], batch: UploadBatch | null) {
    if (fileNames.length === 0) return;
    if (!SAMPLE_MODE && !batch) return; // the backend did not say which upload this was
    log("Uploaded files", fileNames.join(", "));
    clearRun(); // a new upload starts a fresh run
    if (SAMPLE_MODE) {
      startSample(STEPS_AFTER_UPLOAD);
      return;
    }
    batchRef.current = batch;
    sentStep.current = null;
    setData(EMPTY_DATA);
    setSteps(fileNames.map((name) => ({ label: `${name}: waiting to be checked`, state: "waiting" })));
    followPipeline(0);
  }

  // ---- Start: a review of the data already uploaded (no new files) ----
  async function startStoredReview() {
    if (starting) return;
    log("Started a review", "Using the data already uploaded");
    clearRun();
    setOpen(true);
    if (SAMPLE_MODE) {
      startSample(["Loading the data already uploaded", ...STEPS_AFTER_UPLOAD]);
      return;
    }
    batchRef.current = null;
    sentStep.current = null;
    setData(EMPTY_DATA);
    setProgress(0);
    setStage("processing");
    setSteps([{ label: "Loading the data already uploaded", state: "running" }]);
    setStarting(true);
    try {
      const batch = await requestStoredReview(crypto.randomUUID(), tokenRef.current ?? undefined);
      batchRef.current = batch;
      followPipeline(0);
    } catch (err) {
      setStopMessage(err instanceof Error ? err.message : "Could not start the review.");
      setStage("stopped");
    } finally {
      setStarting(false);
    }
  }

  // ---- Step 1: conflicts ----
  function chooseConflict(conflictId: string, optionId: string) {
    setConflictChoices((prev) => ({ ...prev, [conflictId]: optionId }));
  }

  function confirmConflicts() {
    if (!data) return;
    const summary = data.conflicts
      .map((c) => {
        const chosen = c.options.find((o) => o.id === conflictChoices[c.id]);
        return `${c.key} ${c.field}: ${chosen?.value} (${chosen?.file})`;
      })
      .join("; ");
    log("Resolved conflicts", summary);
    if (SAMPLE_MODE) runSteps(STEPS_AFTER_CONFLICTS, 1, () => arrive("forecast"));
    else void send("conflicts", { choices: conflictChoices }, 1);
  }

  // ---- Step 2: forecast ----
  function setOppDecision(oppId: string, decision: Decision) {
    setOppDecisions((prev) => ({ ...prev, [oppId]: decision }));
  }

  // Accepts every undecided CRM-matched opportunity whose kept resources are all valid.
  function acceptAllCrm() {
    if (!data) return;
    setOppDecisions((prev) => {
      const next = { ...prev };
      for (const o of data.opportunities) {
        if (o.source !== "crm" || (next[o.id] ?? "pending") !== "pending") continue;
        const kept = o.resources.filter((r) => !removed[r.id]);
        const valid = kept.length > 0 && kept.every((r) => resourceProblem(editedResource(r, edits[r.id])) === null);
        if (valid) next[o.id] = "accepted";
      }
      return next;
    });
  }

  // Leaving out is safe to do in bulk (accepting a copied project is not): rejects everything still undecided.
  function leaveOutUndecided() {
    if (!data) return;
    setOppDecisions((prev) => {
      const next = { ...prev };
      for (const o of data.opportunities) {
        if ((next[o.id] ?? "pending") === "pending") next[o.id] = "rejected";
      }
      return next;
    });
  }

  function editResource(resourceId: string, edit: ResourceEdit) {
    setEdits((prev) => ({ ...prev, [resourceId]: { ...prev[resourceId], ...edit } }));
  }

  function setRemoved(resourceId: string, isRemoved: boolean) {
    setRemovedMap((prev) => ({ ...prev, [resourceId]: isRemoved }));
  }

  // Sample mode: builds the matching list from what was accepted, then shows it.
  function startSampleMatching(acceptedIds: Set<string>) {
    if (!data) return;
    const accepted = data.opportunities.filter((o) => acceptedIds.has(o.id));
    runSteps(STEPS_AFTER_FORECAST, 2, () => {
      const lines = buildMatchLines(data, accepted, edits, removed);
      setMatchLines(lines);
      setAssignment(firstAssignment(lines));
      setLineDecisions({});
      arrive("matching");
    });
  }

  function confirmForecast() {
    if (!data) return;
    const accepted = data.opportunities.filter((o) => oppDecisions[o.id] === "accepted");
    const editedCount = Object.keys(edits).length;
    const removedIds = Object.keys(removed).filter((id) => removed[id]);
    log(
      "Confirmed forecast",
      `${accepted.length} of ${data.opportunities.length} opportunities accepted, ${editedCount} resources edited, ${removedIds.length} removed`
    );
    setForecastRejected(false);
    if (SAMPLE_MODE) startSampleMatching(new Set(accepted.map((o) => o.id)));
    else void send("forecast", { opportunities: oppDecisions, edits, removed: removedIds }, 2);
  }

  // Rejecting the forecast keeps the pipeline out; matching still runs on current project demand.
  function rejectForecast() {
    log("Rejected forecast", "Pipeline opportunities left out; matching runs on current project demand only");
    setForecastRejected(true);
    if (SAMPLE_MODE) startSampleMatching(new Set());
    else void send("forecast", { rejectedAll: true }, 2);
  }

  // ---- Step 3: matching ----
  function assign(lineId: string, personId: string | null) {
    setAssignment((prev) => ({ ...prev, [lineId]: personId }));
  }

  function setLineDecision(lineId: string, decision: Decision) {
    setLineDecisions((prev) => ({ ...prev, [lineId]: decision }));
  }

  function acceptAllMatches() {
    setLineDecisions((prev) => {
      const next = { ...prev };
      for (const line of matchLines) {
        if ((next[line.id] ?? "pending") === "pending") next[line.id] = "accepted";
      }
      return next;
    });
  }

  function confirmMatching() {
    const matched = matchLines.filter((l) => lineDecisions[l.id] === "accepted" && assignment[l.id]).length;
    log("Confirmed matching list", `${matched} of ${matchLines.length} demand lines matched to a person`);
    if (SAMPLE_MODE) runSteps(STEPS_AFTER_MATCHING, 3, () => arrive("done"));
    else void send("matching", { assignment, decisions: lineDecisions }, 3);
  }

  function rejectMatching() {
    log("Rejected matching list", "Nothing from this run is used");
    if (!SAMPLE_MODE) {
      void send("matching", { rejectedAll: true }, 3);
      return;
    }
    clearTimers();
    setProgress(3);
    arrive("ended");
  }

  function reset() {
    clearTimers();
    batchRef.current = null;
    setStage("idle");
    setSteps([]);
    setProgress(0);
    setData(null);
    setNotices([]);
    setRejectedFiles([]);
    setStopMessage(null);
    setError(null);
    setOpen(false);
  }

  const value: ReviewContextValue = {
    enabled: true,
    mode: SAMPLE_MODE ? "sample" : "pipeline",
    notices,
    rejectedFiles,
    stopMessage,
    error,
    stage,
    steps,
    progress,
    data,
    isOpen,
    setOpen,
    startProcessing,
    startStoredReview: () => void startStoredReview(),
    canStartReview: !starting && (stage === "idle" || stage === "done" || stage === "ended" || stage === "stopped"),
    conflictChoices,
    chooseConflict,
    confirmConflicts,
    oppDecisions,
    edits,
    removed,
    setOppDecision,
    acceptAllCrm,
    leaveOutUndecided,
    editResource,
    setRemoved,
    confirmForecast,
    rejectForecast,
    forecastRejected,
    matchLines,
    assignment,
    lineDecisions,
    assign,
    setLineDecision,
    acceptAllMatches,
    confirmMatching,
    rejectMatching,
    events,
    reset,
  };

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

// "20261022T022156Z" (when a stored file was cleaned) -> "22 Oct 2026, 10:21" in the viewer's time zone.
function formatStamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return stamp;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function ReviewProvider({ children }: ReviewProviderProps) {
  const { user } = useAuth();
  // A different person signing in starts with no review, like the upload list.
  return <ReviewState key={user?.email ?? "signed-out"}>{children}</ReviewState>;
}
