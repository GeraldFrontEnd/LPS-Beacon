// src/api/types.ts
// This file only DESCRIBES the shape of our data. It contains no logic.
// Other files import these types so TypeScript can catch mistakes
// (for example, using "reply" where the backend really sends "message").

// "user" | "assistant" is a union type: a Sender can only be one of these two strings.
export type Sender = "user" | "assistant";

// One bubble in the chat window.
export interface ChatMessage {
  id: string; // unique id; React needs it to keep track of each item in a list
  sender: Sender; // who wrote the message
  text: string; // the words shown in the bubble
  timestamp: string; // when it was created, as an ISO date string
}

// What we send to the backend when the user presses Send.
export interface SendMessageRequest {
  sessionId: string; // identifies this conversation (later used for chat history in DynamoDB)
  message: string; // the user's question
}

// What we expect the backend to send back.
export interface SendMessageResponse {
  reply: string; // the assistant's answer
}

// ---- Added for the upload page ----

// The life of one file on the upload page, from chosen to finished.
export type UploadStatus = "ready" | "uploading" | "done" | "error";

// One row in the upload list.
export interface UploadItem {
  id: string; // unique id so React can track the row
  file: File; // the real file the user picked (File is a built-in browser type)
  status: UploadStatus; // where this file is in the process
  error?: string; // the "?" means optional: only present when status is "error"
}

// Step 1 of uploading: we ask the backend for a one-time upload link, telling it which file we have.
export interface UploadUrlRequest {
  fileName: string; // e.g. "october-allocations.csv"
  contentType: string; // the file type, e.g. "text/csv"
  // The same id for every file of one upload, so the files land in one folder and the forecast pipeline
  // runs once, after the last of them.
  batchId?: string;
  // false for "Upload without review": the files are checked and stored, but no review starts. Omitted otherwise.
  review?: false;
}

// The backend answers with the link.
export interface UploadUrlResponse {
  uploadUrl: string; // a temporary S3 address we can send the file to directly
  key: string; // the path the file will have inside the S3 bucket
  batchId?: string; // echoed back when a batchId was sent
  date?: string; // the upload folder's date ("YYYY-MM-DD"); with batchId it identifies the upload
}

// The three places where the forecast pipeline waits for the user after an upload.
export type ReviewStep = "conflicts" | "forecast" | "matching";

// GET /pipeline/uploads/{date}/{batchId}: the pipeline's status file for one upload.
export interface PipelineUploadStatus {
  batchId: string;
  // "stored" when the review uses the data already uploaded instead of new files. Missing means an upload.
  source?: "upload" | "stored";
  files: {
    name: string;
    status: "cleaned" | "quarantined";
    dataset?: string | null;
    reason?: string | null;
    warnings?: string[] | null;
    cleanedAt?: string | null; // when the stored copy was cleaned, e.g. "20261022T022156Z" (stored reviews)
  }[];
  run: {
    // waiting_for_files, waiting_for_inputs, not_run, disabled, running, awaiting_review, published, ended, failed
    state: string;
    message?: string;
    step?: ReviewStep; // with awaiting_review: the step it waits for
    at?: string; // when the run state last changed (ISO time)
    runId?: string;
    warnings?: string[];
  };
}

// Which upload a set of files belonged to. GET /pipeline/uploads/{date}/{batchId} returns its progress.
export interface UploadBatch {
  batchId: string;
  date: string;
}

// ---- Added for the Analysis page (the capacity plan) ----

// The numbers of the capacity plan. The layout (which rows and columns exist) lives in
// src/analysis/capacityPlanLayout.ts; the backend only sends values, looked up by id.
// Money is in plain dollars (the screen shows millions) and percentages are fractions (0.85 = 85%).
export interface CapacityPlan {
  // rowId -> column key -> number. For example values["joiners:b7"]["Oct'26"] = 2.
  // A missing entry or null means "no value", and the cell is shown empty.
  values: Record<string, Record<string, number | null>>;
  // The rest comes from GET /analysis (the sample plan leaves it out).
  months?: PlanMonthInfo[]; // which months are actual (the UR report has them) and which are forecast
  edited?: Record<string, CellEditInfo>; // "<rowId>|<columnKey>" -> who changed that cell; edits are shared
  currency?: string; // "USD": every amount in the plan
  notes?: string[]; // what to know about the plan (assumed settings, missing files, ...)
  settings?: Record<string, PlanFySettings>; // per fiscal year, e.g. settings["FY26"]
  cleared?: number; // after "Clear my edits": how many were removed
  hires?: HiringNeeds | null; // the latest review's hiring gap: the default joiners
  productivity?: Productivity | null; // by agency and project, this FY to date (ABCD x SL x RP)
  revenueByMonth?: Record<string, { revenue: number; cost: number; actual: boolean }> | null; // ABCD, Singapore
  demandByMonth?: Record<string, { fte: number; project: number; quoteWon: number }> | null; // SL x RP, won + ongoing
  actualFteByMonth?: Record<string, number> | null; // FTE actual: all clocked billable days that month ÷ 18
  actualFteSource?: "mspo" | "ur" | "none"; // MSPO clocking export, or the UR report as a stand-in
  workdayMonths?: string[]; // months whose joiners and leavers come from a Workday report ("2026-09")
  startingHeadcountSource?: "bu_ur" | "staff_list" | null;
  // Management target view: the typed lines, "<FY>|<period>|<column>|<rowId>" -> value (USD, costs negative; HC)
  managementTarget?: Record<string, ManagementTargetCell>;
}

export interface ManagementTargetCell {
  value: number;
  mine: boolean;
  byName: string | null;
  at: string | null;
}

// PATCH /analysis {"target": ...}: one typed line of the management target view. value null clears it.
export interface ManagementTargetEdit {
  fiscalYear: string; // "FY26"
  period: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  column: "prior" | "mt" | "current";
  rowId: string;
  value: number | null;
}

// ---- Productivity (Analysis page and Dashboard) ----

export type Flag = "red" | "amber" | "green";

// Revenue, cost and FTE of one agency or project over the fiscal year to date. Per-FTE figures are annualised.
export interface ProductivityFigures {
  revenue: number; // USD, the months covered
  hcCost: number; // FTE actual days x rate card (iRate)
  gp: number; // revenue - hcCost
  headcount: number; // people on it in the last month of the period (distinct names)
  headcountAverage?: number; // people on it, average a month over the period
  byMonth?: Record<string, ProductivityMonth>; // the building blocks per month (pipeline after 4 Nov 2026)
  fte: number; // FTE actual, average a month: clocked billable days / 18 (MSPO clocking, else the UR report split by
  // plan); planned FTE when nothing is clocked
  planFte: number; // average planned FTE a month (SL x RP man-days / 18)
  daysPerHead: number | null; // clocked billable days per person a month; red below 15.3 or above 18
  revenuePerFte: number | null;
  gpPerFte: number | null;
  revenuePerHcCost: number | null;
  requiredFte: number | null; // the FTE its revenue needs (the calculator's formula, default settings)
  ratePerDay: number | null; // weighted rate card (iRate) of its people, USD a day
  flag: Flag | null; // the worse of the productivity and utilisation flags; null = not flagged
  productivityFlag: Flag | null;
  utilisationFlag: Flag | null;
  flagReason: string;
}

// One agency's or project's month: what the Analysis page adds up for the period picked.
export interface ProductivityMonth {
  revenue: number; // USD (ABCD)
  hcCost: number; // USD at the rate card
  actualDays: number; // clocked billable days (FTE actual = ÷ 18)
  planDays: number; // planned man-days (SL x RP)
  people: number; // distinct people on it
  clockedDays: number; // clocked billable days of those people, all their projects (each person once)
  clockedPeople: number; // how many of them clocked
}

export interface ProjectProductivity extends ProductivityFigures {
  projectId: string;
  projectName: string;
}

export interface AgencyProductivity extends ProductivityFigures {
  agency: string;
  projects: ProjectProductivity[];
}

export interface FlagRules {
  draft: boolean;
  metrics: string[]; // which per-FTE figures can turn an agency red or amber
  productivity: { redBelowPct: number; amberBelowPct: number };
  // Missing when inputs.json was built by a pipeline older than 4 Nov 2026: the page falls back to the agreed rule.
  utilisation?: { fullMonthManDays: number; urTarget: number; redBelowDays: number; redAboveDays: number };
  minFte: number;
}

export interface Productivity {
  fiscalYear: string;
  months: string[]; // "2026-04" .. the latest month with ABCD actuals and clocking
  latestMonth?: string; // the month the HC is counted in
  clocked?: boolean; // false: no UR report for these months, so FTE is planned
  companyAverage: { revenuePerFte: number | null; gpPerFte: number | null; revenuePerHcCost: number | null };
  rules: FlagRules;
  agencies: AgencyProductivity[]; // red first, then amber, green, not flagged; by revenue within each
}

// The people the latest published review found must be hired, per month ("2026-11") and band ("b7").
export interface HiringNeeds {
  runId: string | null;
  publishedAt: string | null;
  byMonth: Record<string, Record<string, { heads: number; roles: Record<string, number> }>>;
}

export interface PlanMonthInfo {
  key: string; // the column key, e.g. "Apr'26"
  month: string; // "2026-04"
  fiscalYear: string; // "FY26"
  actual: boolean;
}

export interface CellEditInfo {
  mine: boolean; // changed by the signed-in user
  byName: string | null; // who changed it, when known
  at: string | null; // when (ISO time)
}

export interface PlanFySettings {
  urTargets: Record<string, number>; // "all" and "b9".."b3", as fractions
  sgdPerUsd?: number;
  revenuePerMonthUsd?: number;
  basedOn?: string; // set when this year borrows another year's settings
  bandDayRatesUsd?: Record<string, number>; // the rate card (iRate): cost per day per band, USD
  // The FTE-required calculator's defaults (plan_settings.py "target").
  target?: { revenueUsd: number; gpPct: number; billableUr: number; manDaysPerFte?: number; manDaysAreBillable?: boolean };
  priorYear?: { fiscalYear: string; averageHeadcount: number; staffCostUsd: number; source: string };
}

// ---- Added for the Dashboard (headcount today, from the HR headcount file) ----

// How many active staff there are today, split by employment type.
// Permanent staff = regular + supplementalOther + supplementalRetiree. The web app adds up the totals itself.
export interface HeadcountBreakdown {
  asOf: string; // the date the numbers are for, as an ISO date string, e.g. "2026-10-19"
  permanent: {
    regular: number; // Regular Employee
    supplementalOther: number; // Supplemental - Other
    supplementalRetiree: number; // Supplemental - Retiree
  };
  secondment: number;
}

// GET /dashboard?agency=&projectId=: the headcount by employment type, the filter's lists, and the selection's figures.
export interface DashboardMonthCell {
  fte: number; // FTE demand on won and ongoing work (SL x RP man-days / 18)
  people: number; // people planned that month
  permanent: number;
  secondment: number;
  other: number; // Supplemental types (open question #12)
  unknown: number; // on neither the staff list nor the UR report
  billable: number; // UR report billable days of those people
  workingDays: number; // and their standard working days
  actualFte?: number; // FTE actual: clocked billable days on its projects ÷ 18 (clocked months only)
}

export interface DashboardView extends Partial<HeadcountBreakdown> {
  filters: { agencies: string[]; projects: { id: string; name: string; agency: string | null }[] };
  selection: {
    kind: "agency" | "project";
    agency: string | null;
    projectId?: string;
    name?: string;
    projects?: string[];
    byMonth: Record<string, DashboardMonthCell>;
  } | null;
  people?: DashboardPeople; // with a selection: who is on it in ?month= (Finance/HR only)
}

// The people on the Dashboard's selection in one month (GET /dashboard ... &month=).
export interface DashboardPeople {
  month: string | null; // "2026-10"
  clocked: boolean; // false: a month with no clocking yet, plan only
  actualSource?: "mspo" | "ur" | "none";
  rows: DashboardPerson[];
}

export interface DashboardPerson {
  name: string | null;
  position: string | null;
  band: number | null;
  employment: string | null; // permanent, secondment, other, unknown
  projectId: string;
  projectName: string | null;
  planDays: number | null; // planned on this project (SL x RP)
  actualDays: number | null; // clocked to this project (null: not clocked yet)
  actualFte: number | null;
  clockedDaysAllProjects: number | null; // all their projects that month
}

// One cell a person has changed on the Analysis page.
export interface CapacityPlanEdit {
  rowId: string; // for example "joiners:b7"
  columnKey: string; // for example "Oct'26"
  value: number | null; // plain US dollars, or a fraction for percentages; null puts the calculated value back
}

// ---- Chat history kept on the server (DynamoDB) ----

// One chat in the sidebar, as GET /sessions returns it (without its messages).
export interface SessionSummary {
  id: string;
  title: string;
  projectId: string | null; // the folder it is filed in, or null for the main Chats list
  createdAt: number; // milliseconds since 1970
  updatedAt: number;
}

// One sidebar folder, as GET /folders returns it.
export interface FolderSummary {
  id: string;
  name: string;
  createdAt: number;
}

// ---- Activity (the bell on the top bar) ----

// One entry: who did what, and when. Several files of one upload, or capacity plan changes made close
// together, arrive as one entry with a count and up to 20 detail lines.
export interface ActivityEvent {
  id: string;
  email: string;
  mine: boolean; // done by the signed-in user (shown as "You", never counted as new)
  area: "Upload" | "Review" | "Analysis" | "Other";
  text: string; // what they did, e.g. "changed 3 cells in the capacity plan"
  details: string[]; // e.g. file names, or "Joiners · Band 7 · Nov'26: 3"
  count: number;
  at: string; // ISO time of the latest action in the entry
  new: boolean; // by someone else, after this user last opened the bell
}

// GET /activity
export interface ActivityFeed {
  events: ActivityEvent[];
  seenAt: string | null;
  unseen: number; // entries by other people since this user last opened the bell: the red dot
}
