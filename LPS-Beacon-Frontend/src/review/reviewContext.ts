// src/review/reviewContext.ts
// The shared box that holds the review run, so it survives moving between pages.
// ReviewProvider fills it; useReview reads it.

import { createContext } from "react";
import type { UploadBatch } from "../api/types";
import type {
  Decision,
  RejectedFile,
  MatchLine,
  ProcessingStep,
  ResourceEdit,
  ReviewData,
  ReviewEvent,
  ReviewStage,
} from "./types";

export interface ReviewContextValue {
  enabled: boolean; // true when there is something that can produce a review (sample data or the pipeline)
  mode: "sample" | "pipeline"; // sample data (demos), or the real forecast pipeline behind the API
  notices: string[]; // notes from the pipeline about this step (e.g. "no ABCD file uploaded yet")
  rejectedFiles: RejectedFile[]; // uploaded files the pipeline did not use, with the reason
  stopMessage: string | null; // why the review stopped (stage "stopped")
  error: string | null; // a request that failed (sending decisions, loading a step)
  stage: ReviewStage;
  steps: ProcessingStep[]; // the checklist shown while stage is "processing"
  progress: number; // which review step the run is on: 0 conflicts, 1 forecast, 2 matching, 3 finished
  data: ReviewData | null;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  // Called by UploadProvider after an upload. batch identifies the upload for the pipeline (null in mock mode).
  // options.review false: the files are only checked and stored, no review starts (stage "saved" at the end).
  startProcessing: (fileNames: string[], batch: UploadBatch | null, options?: { review?: boolean }) => void;
  // Starts a review of the data already uploaded, without uploading the files again.
  startStoredReview: () => void;
  canStartReview: boolean; // false while a review is in progress

  // Going back and forth between the forecast and the matching, once the matching was reached.
  reachedMatching: boolean;
  revisingForecast: boolean; // true while the forecast is open again after the matching was reached
  goToStep: (step: "forecast" | "matching") => void;
  forecastDirty: boolean; // the reopened forecast differs from the one the matching was calculated from
  leavePrompt: boolean; // asking whether to discard those changes before going back to the matching
  discardForecastChanges: () => void; // undoes them and goes back to the matching
  cancelLeave: () => void; // stays on the forecast

  // Step 1: conflicts. conflictId -> chosen option id.
  conflictChoices: Record<string, string>;
  chooseConflict: (conflictId: string, optionId: string) => void;
  confirmConflicts: () => void;

  // Step 2: forecast.
  oppDecisions: Record<string, Decision>;
  edits: Record<string, ResourceEdit>; // resource id -> changed fields
  removed: Record<string, boolean>; // resource id -> true when removed
  setOppDecision: (oppId: string, decision: Decision) => void;
  acceptAllCrm: () => void;
  leaveOutUndecided: () => void; // rejects every opportunity nobody decided on yet
  editResource: (resourceId: string, edit: ResourceEdit) => void;
  setRemoved: (resourceId: string, isRemoved: boolean) => void;
  confirmForecast: () => void;
  rejectForecast: () => void;
  forecastRejected: boolean;

  // Step 3: matching.
  matchLines: MatchLine[];
  assignment: Record<string, string | null>; // line id -> person id, or null for "hire"
  lineDecisions: Record<string, Decision>;
  assign: (lineId: string, personId: string | null) => void;
  setLineDecision: (lineId: string, decision: Decision) => void;
  acceptAllMatches: () => void;
  confirmMatching: () => void;
  rejectMatching: () => void;

  events: ReviewEvent[]; // what people did, for the activity log
  reset: () => void; // back to "idle"
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);
