// src/review/types.ts
// The shapes used by the review panel on the Upload page. No logic here, only types.
//
// The flow after an upload:
//   1. Conflicts: the same record (IT Code, project ID, quote line) has different values in two files.
//      The user picks which value is the source of truth; the other values are excluded (not deleted).
//   2. Forecast:  the resources each pipeline opportunity needs. Accept, edit or reject per opportunity.
//   3. Matching:  each demand line gets a ranked list of available people. Accept, swap or reject per line.
//   Then the hiring demand is worked out from unfilled lines (not shown here) and the review is done.

// ---- Data the system produces (today from sampleReviewData.ts, later from the backend) ----

// An uploaded file the pipeline did not use, and why.
export interface RejectedFile {
  name: string;
  reason: string;
}

// One file's version of a conflicting value.
export interface ConflictOption {
  id: string;
  file: string; // the uploaded file the value came from
  value: string; // the value as shown to the user, e.g. "Band 7"
  location: string; // where in that file, e.g. "Export, row 1204"
}

// The same record with different values in two or more files.
export interface Conflict {
  id: string;
  entity: string; // what kind of record, e.g. "Employee"
  key: string; // the shared key, e.g. the IT Code
  label: string; // a readable name for the record
  field: string; // the field that disagrees, e.g. "Grade"
  options: ConflictOption[];
}

// Where an opportunity's resource list came from.
//  crm:     its CRM ID is in SL x RP, so it has its own resource plan
//  similar: copied from a similar past project (a recommendation only, never the final decision)
//  manual:  no plan and no similar project; the user has to enter the resources
export type ForecastSource = "crm" | "similar" | "manual";

// One resource an opportunity needs.
export interface ForecastResource {
  id: string;
  sourceId: string; // the SL x RP ID (quote line or project) the row came from
  position: string;
  grade: number; // band 3 to 9
  start: string; // first month, "YYYY-MM"
  end: string; // last month, "YYYY-MM"
  fte: number; // average FTE per month (man-days / 18)
  manDays: number; // total man-days
  duplicateOf?: string; // set when this row looks like a copy of another row in the same opportunity
  alreadyInQuoteLines?: string; // set when its quote line number is already in the uploaded quote line file
  demandType?: string; // the SL x RP demand type it came from ("Project", "Quote O4", ...)
}

// The fields of a resource the user may change.
export type EditableResourceField = "position" | "grade" | "start" | "end" | "fte";
export type ResourceEdit = Partial<Pick<ForecastResource, EditableResourceField>>;

// The past project a "similar" opportunity was based on.
export interface SimilarBasis {
  projectId: string;
  projectName: string;
  tcvUsd: number;
  start: string | null;
  end: string | null;
  offering: string;
  shiftedMonths?: number; // how far its months were moved to line up with the opportunity's start
  score?: number; // 0-1, how alike the system judged the two
  reasons?: string[]; // why, e.g. "TCV 94% alike", "same offering (ATFM)"
  // Added for the side-by-side comparison. Missing on reviews prepared before it existed.
  durationMonths?: number | null; // the past project's length
  opportunityMonths?: number | null; // the opportunity's length (revenue months)
  threshold?: number; // the lowest score that counts as a match, 0-1
  weights?: Record<string, number>; // how much each criterion counts, e.g. { tcv: 0.35, ... }
  match?: SimilarMatch;
}

// How alike the opportunity and the past project are, criterion by criterion.
export interface SimilarMatch {
  tcv: number; // 0-1
  duration: number; // 0-1, 0 when a length is unknown
  offering: boolean;
  name: number; // 0-1, share of name words in common
}

// One pipeline opportunity and the resources the system proposes for it.
export interface Opportunity {
  id: string;
  crmId: string;
  name: string;
  customer: string;
  stage: string;
  probability: number; // 0 to 1
  tcvUsd: number;
  expectedClose: string | null; // "YYYY-MM"
  start: string | null; // first month with revenue
  end: string | null; // last month with revenue
  offering: string;
  source: ForecastSource;
  basis: SimilarBasis | null; // only for source "similar"
  resources: ForecastResource[];
}

// A demand line from a current project (already in the quote line / resource plan files).
export interface CurrentDemand {
  id: string;
  source: "current";
  projectId: string;
  quoteLine: string;
  customer: string;
  projectName: string;
  position: string;
  grade: number;
  start: string | null;
  manDays: number;
  candidates: string[]; // person ids, best first; empty when nobody fits
}

// An available person who could fill a demand line.
export interface Person {
  id: string;
  label: string;
  position: string;
  grade: number;
  availableFrom: string; // "YYYY-MM"
  status: string; // "Available now", "Rolling off 0-6m", "Rolling off 7-12m"
  currentProject: string;
}

// Everything one processing run produces.
export interface ReviewData {
  sourceFiles: string[];
  conflicts: Conflict[];
  opportunities: Opportunity[];
  currentDemand: CurrentDemand[];
  pipelineCandidates: Record<string, string[]>; // forecast resource id -> person ids, best first
  people: Record<string, Person>;
}

// ---- The user's progress through the review ----

// Where the run is. "processing" shows a checklist; the three review stages wait for the user.
export type ReviewStage =
  | "idle" // nothing uploaded yet
  | "processing" // the system is working (see ProcessingStep)
  | "conflicts"
  | "forecast"
  | "matching"
  | "done" // matching confirmed
  | "ended" // matching list rejected: nothing from this run is used
  | "saved" // uploaded without review: the files were checked and stored, nothing else ran
  | "stopped"; // the pipeline could not go on (all files rejected, a file missing, or an error)

export interface ProcessingStep {
  label: string;
  state: "waiting" | "running" | "done";
}

export type Decision = "pending" | "accepted" | "rejected";

// One line of the matching list: a current project need, or a resource from an accepted opportunity.
export interface MatchLine {
  id: string;
  source: "current" | "pipeline";
  title: string; // the project or opportunity name
  reference: string; // quote line number, or CRM ID
  position: string;
  grade: number;
  start: string | null;
  candidates: string[]; // person ids, best first
}

// Something a person did, kept for the activity log.
export interface ReviewEvent {
  at: string; // ISO time
  user: string;
  action: string;
  detail: string;
}
