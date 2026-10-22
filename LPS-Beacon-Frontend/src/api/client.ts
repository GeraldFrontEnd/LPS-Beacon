// src/api/client.ts
// Every call to the backend lives in this file. When your teammates give you the
// real endpoints, this is (almost) the only file you will need to change.

// "import type" tells TypeScript these are only types, so they disappear when the app is built.
import type {
  SendMessageRequest,
  SendMessageResponse,
  PipelineUploadStatus,
  ReviewStep,
  UploadBatch,
  UploadUrlRequest,
  UploadUrlResponse,
  CapacityPlan,
  CapacityPlanEdit,
  HeadcountBreakdown,
  ChatMessage,
  SessionSummary,
  FolderSummary,
} from "./types";

// import.meta.env reads values from the .env file. Vite only exposes names that start with VITE_.
// Values are always strings, so we compare to the text "true" instead of the boolean true.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
// Chat history (chats, messages, folders) is kept on the server unless the app runs on mock data.
export const USE_SERVER_HISTORY = !USE_MOCK;
// Only the capacity plan (Dashboard charts and Analysis tab) uses made-up data; everything else stays real.
const USE_SAMPLE_PLAN = import.meta.env.VITE_USE_SAMPLE_PLAN === "true";

// The base URL of API Gateway, for example https://abc123.execute-api.ap-southeast-1.amazonaws.com
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

// Every API Gateway route the web app uses or will use, in one place. These must match the routes in
// API Gateway exactly (paths are case-sensitive). See API_CONTRACT.md for the request and response shapes.
export const API_ROUTES = {
  chat: "/chat", // POST
  uploadUrl: "/upload-url", // POST
  analysis: "/analysis", // GET the capacity plan, PATCH one edited cell (planned)
  dashboard: "/dashboard", // GET today's headcount breakdown (planned)
  runForecast: "/runs/runForecast", // POST start a forecast run (planned)
  run: (runId: string) => `/runs/${encodeURIComponent(runId)}`, // GET run status (planned)
  sessions: "/sessions", // GET list chats. No POST: the first /chat call with a new sessionId creates the chat
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`, // PATCH rename or move to a folder, DELETE
  sessionMessages: (id: string) => `/sessions/${encodeURIComponent(id)}/messages`, // GET
  folders: "/folders", // GET list folders (the first call creates the default ones), POST create
  folder: (id: string) => `/folders/${encodeURIComponent(id)}`, // PATCH rename, DELETE (its chats move out)
  // The forecast pipeline's progress for one upload, and its review steps (GET the findings, POST the decisions).
  uploadStatus: (b: UploadBatch) => `/pipeline/uploads/${encodeURIComponent(b.date)}/${encodeURIComponent(b.batchId)}`,
  uploadReview: (b: UploadBatch, step: ReviewStep) =>
    `/pipeline/uploads/${encodeURIComponent(b.date)}/${encodeURIComponent(b.batchId)}/review/${step}`,
  // POST: a review of the data already uploaded, without new files. Followed with uploadStatus, like an upload.
  storedReview: "/pipeline/reviews",
} as const;

// A tiny helper that pauses for a number of milliseconds (used to fake network delay).
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns the API address, or stops with a clear message if it was never configured.
function requireApiUrl(): string {
  if (!API_URL) {
    throw new Error("VITE_API_URL is not set. Add it to your .env file.");
  }
  return API_URL;
}

// ---- The login token ----
// AuthProvider registers two functions here when the app starts:
//  - tokenProvider returns a valid login token, renewing it first if it is about to expire (null = cannot renew)
//  - onSessionExpired signs the user out and sends them to the sign-in page with an explanation
// Every request below asks for the token just before it is sent, so a tab left open for hours keeps working.
// The "token" parameters on the functions below are only used if no provider is registered (for example in tests).
type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAuthHandlers(provider: TokenProvider | null, expired: (() => void) | null): void {
  tokenProvider = provider;
  onSessionExpired = expired;
}

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

function sessionExpired(): Error {
  onSessionExpired?.();
  return new Error(SESSION_EXPIRED);
}

// The headers for one request, with a token that is valid right now.
async function authHeaders(fallbackToken?: string): Promise<Record<string, string>> {
  if (!tokenProvider) return buildHeaders(fallbackToken);
  const token = await tokenProvider();
  if (!token) throw sessionExpired();
  return buildHeaders(token);
}

// Builds the headers that every request to our API needs.
// Record<string, string> means "an object whose keys and values are both text".
function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Only attach the login token if we have one.
  // Ask your teammates whether API Gateway expects the raw token or "Bearer <token>".
  if (token) headers.Authorization = token;
  return headers;
}

// Sends the user's question and returns the assistant's reply.
// "async" means the function can pause and wait for slow things (like the network).
// "token" is the login token from Cognito; it is optional for now because login is not built yet.
export async function sendMessage(
  req: SendMessageRequest,
  token?: string
): Promise<SendMessageResponse> {
  // Mock mode: return a fake answer so you can build the screen without a backend.
  if (USE_MOCK) {
    await wait(800); // pretend the server needs 0.8 seconds
    return {
      reply: `Mock answer to "${req.message}": 5 people are available for Project A in November.`,
    };
  }

  // fetch sends the HTTP request. We POST the request object as JSON text.
  const response = await fetch(`${requireApiUrl()}${API_ROUTES.chat}`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify(req),
  });

  // response.ok is false for errors like 401 (not logged in) or 500 (server problem).
  if (response.status === 401) throw sessionExpired();
  if (!response.ok) {
    throw new Error(`The server returned an error (${response.status}).`);
  }

  // Read the JSON body and tell TypeScript it matches SendMessageResponse.
  return (await response.json()) as SendMessageResponse;
}

// ---- Added for the upload page ----

// Step 1: ask our backend for a temporary upload link for one file.
// We do this so files go straight to S3 and never pass through our API.
export async function getUploadUrl(
  req: UploadUrlRequest,
  token?: string
): Promise<UploadUrlResponse> {
  // Mock mode: return a made-up link.
  if (USE_MOCK) {
    await wait(300);
    const date = new Date().toISOString().slice(0, 10);
    return req.batchId
      ? { uploadUrl: "mock://upload", key: `raw/mock/${date}/${req.batchId}/${req.fileName}`, batchId: req.batchId, date }
      : { uploadUrl: "mock://upload", key: `raw/${req.fileName}` };
  }

  const response = await fetch(`${requireApiUrl()}${API_ROUTES.uploadUrl}`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify(req),
  });

  if (response.status === 401) throw sessionExpired();
  if (!response.ok) {
    throw new Error(`Could not get an upload link (${response.status}).`);
  }

  return (await response.json()) as UploadUrlResponse;
}

// Uploads one file: step 1 (get the link) and step 2 (send the file to that link).
// batchId groups the files of one upload (see UploadUrlRequest). Returns the upload's batch, when the backend
// sent one back, or null.
// review: false stores the files without starting a review ("Upload without review").
export async function uploadFile(
  file: File,
  token?: string,
  batchId?: string,
  review = true
): Promise<UploadBatch | null> {
  // Some computers don't report a type for CSV files, so we fall back to a generic one.
  // The SAME value is used in both steps; if they differ, S3 can reject the upload.
  const contentType = file.type || "application/octet-stream";

  const link = await getUploadUrl(
    { fileName: file.name, contentType, batchId, ...(review ? {} : { review: false as const }) },
    token
  );
  const { uploadUrl } = link;
  const batch = link.batchId && link.date ? { batchId: link.batchId, date: link.date } : null;

  // Mock mode: pretend to upload, and fail on purpose if the file name contains "fail".
  // This lets you test the error state on the upload page.
  if (USE_MOCK) {
    await wait(1000);
    if (file.name.toLowerCase().includes("fail")) {
      throw new Error("Mock upload failed (the file name contains the word fail).");
    }
    return batch;
  }

  // Step 2: PUT the file itself to the temporary S3 link.
  // Note: this request goes to S3, not to our API, so it does NOT carry the login token.
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload to storage failed (${response.status}).`);
  }
  return batch;
}

// ---- Added for the Analysis page ----

// Cells edited while the sample plan is in use. They live in memory only, so a page reload starts from scratch.
const sampleEdits: Record<string, number> = {};

// Loads the capacity plan the system generated.
// With VITE_USE_SAMPLE_PLAN=true (or VITE_USE_MOCK=true) it returns a made-up sample plan so the Dashboard and
// Analysis screens can be previewed.
// TODO: the backend does not generate the plan yet, so otherwise this returns an empty plan and the screens show
// no data. When it does, call GET /analysis (API_ROUTES.analysis) here (same pattern as the chat call) and return its JSON.
export async function getCapacityPlan(token?: string): Promise<CapacityPlan> {
  if (USE_MOCK || USE_SAMPLE_PLAN) {
    await wait(400);
    // Loaded only when needed, so the sample code is not part of a normal build's main file.
    const { buildSampleCapacityPlan } = await import("./sampleCapacityPlan");
    return buildSampleCapacityPlan(sampleEdits);
  }
  void token; // will be sent as the login token once the real call exists
  return { values: {} };
}

// Saves one edited cell and returns the WHOLE plan again, because changing one input changes many formula cells
// (ending headcount, revenue, cost, margin, quarter and year totals). The screen shows what comes back.
// TODO: when the backend exists, send the edit (PATCH /analysis with the edit as JSON) and return
// the recalculated plan it answers with. Until then, only the sample plan can be edited.
export async function saveCapacityPlanEdit(edit: CapacityPlanEdit, token?: string): Promise<CapacityPlan> {
  if (USE_MOCK || USE_SAMPLE_PLAN) {
    await wait(150);
    const { buildSampleCapacityPlan, sampleEditKey } = await import("./sampleCapacityPlan");
    sampleEdits[sampleEditKey(edit.rowId, edit.columnKey)] = edit.value;
    return buildSampleCapacityPlan(sampleEdits);
  }
  void token;
  throw new Error("Saving changes is not available yet, because the backend does not support it.");
}

// ---- Added for the Dashboard headcount boxes ----

// Loads today's headcount split by employment type (permanent staff and secondment).
// With VITE_USE_SAMPLE_PLAN=true (or VITE_USE_MOCK=true) it returns made-up numbers so the Dashboard can be previewed.
// TODO: the backend does not provide this yet, so otherwise this returns null and the boxes show "–". When it does,
// call GET /dashboard (API_ROUTES.dashboard, same pattern as the chat call) and return its JSON.
export async function getHeadcountBreakdown(token?: string): Promise<HeadcountBreakdown | null> {
  if (USE_MOCK || USE_SAMPLE_PLAN) {
    await wait(300);
    // SYNTHETIC numbers, not real staff counts.
    return {
      asOf: new Date().toISOString().slice(0, 10),
      permanent: { regular: 412, supplementalOther: 23, supplementalRetiree: 9 },
      secondment: 37,
    };
  }
  void token;
  return null;
}

// ---- Chat history kept on the server ----

// Calls our API and returns the JSON answer (or nothing for 204 No Content). Throws a readable error otherwise.
async function apiRequest<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const response = await fetch(`${requireApiUrl()}${path}`, {
    method,
    headers: await authHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) throw sessionExpired();
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      // the body was not JSON; the status code is enough
    }
    throw new Error(detail ? `${detail} (${response.status}).` : `The server returned an error (${response.status}).`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// The signed-in user's chats, newest first (without their messages).
export async function listSessions(token?: string): Promise<SessionSummary[]> {
  return (await apiRequest<{ sessions: SessionSummary[] }>("GET", API_ROUTES.sessions, token)).sessions;
}

// One chat's messages, oldest first.
export async function getSessionMessages(id: string, token?: string): Promise<ChatMessage[]> {
  return (await apiRequest<{ messages: ChatMessage[] }>("GET", API_ROUTES.sessionMessages(id), token)).messages;
}

// Renames a chat and/or moves it to a folder (projectId null = back to the main Chats list).
export async function updateSession(
  id: string,
  change: { title?: string; projectId?: string | null },
  token?: string,
): Promise<SessionSummary> {
  return apiRequest<SessionSummary>("PATCH", API_ROUTES.session(id), token, change);
}

// Deletes a chat and all of its messages.
export async function deleteSession(id: string, token?: string): Promise<void> {
  await apiRequest<void>("DELETE", API_ROUTES.session(id), token);
}

// The signed-in user's sidebar folders.
export async function listFolders(token?: string): Promise<FolderSummary[]> {
  return (await apiRequest<{ folders: FolderSummary[] }>("GET", API_ROUTES.folders, token)).folders;
}

// Creates a folder. The web app chooses the id, so the new folder can be shown straight away.
export async function createFolder(folder: { id: string; name: string }, token?: string): Promise<FolderSummary> {
  return apiRequest<FolderSummary>("POST", API_ROUTES.folders, token, folder);
}

export async function renameFolder(id: string, name: string, token?: string): Promise<FolderSummary> {
  return apiRequest<FolderSummary>("PATCH", API_ROUTES.folder(id), token, { name });
}

// Deletes a folder. The server moves its chats back to the main Chats list.
export async function deleteFolder(id: string, token?: string): Promise<void> {
  await apiRequest<void>("DELETE", API_ROUTES.folder(id), token);
}

// ---- Review of an upload (the forecast pipeline pauses for the user three times) ----

// Where the pipeline is with one upload: files cleaned or rejected, and the run state.
export async function getUploadStatus(batch: UploadBatch, token?: string): Promise<PipelineUploadStatus> {
  const response = await fetch(`${requireApiUrl()}${API_ROUTES.uploadStatus(batch)}`, {
    headers: await authHeaders(token),
  });
  if (response.status === 401) throw sessionExpired();
  if (!response.ok) throw new Error(`Could not load the upload's progress (${response.status}).`);
  return (await response.json()) as PipelineUploadStatus;
}

// What the pipeline found for one review step. The shape depends on the step (see src/review/types.ts).
export async function getReviewStep<T>(batch: UploadBatch, step: ReviewStep, token?: string): Promise<T> {
  const response = await fetch(`${requireApiUrl()}${API_ROUTES.uploadReview(batch, step)}`, {
    headers: await authHeaders(token),
  });
  if (response.status === 401) throw sessionExpired();
  if (!response.ok) throw new Error(`Could not load the ${step} review (${response.status}).`);
  return (await response.json()) as T;
}

// Starts a review of the data already uploaded (the latest cleaned copy of every file), so nothing has to be
// uploaded again. batchId is a new id made by the page, as for an upload. The answer says which "upload" to follow
// with getUploadStatus.
export async function startStoredReview(batchId: string, token?: string): Promise<UploadBatch> {
  const response = await fetch(`${requireApiUrl()}${API_ROUTES.storedReview}`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify({ batchId }),
  });
  if (response.status === 401) throw sessionExpired();
  if (response.status === 403) throw new Error("Your role is not allowed to start a review.");
  if (!response.ok) throw new Error(`Could not start the review (${response.status}).`);
  return (await response.json()) as UploadBatch;
}

// Sends the user's decisions for a step. The pipeline continues in the background; follow it with getUploadStatus.
export async function postReviewDecisions(
  batch: UploadBatch,
  step: ReviewStep,
  decisions: object,
  token?: string
): Promise<void> {
  const response = await fetch(`${requireApiUrl()}${API_ROUTES.uploadReview(batch, step)}`, {
    method: "POST",
    headers: await authHeaders(token),
    body: JSON.stringify({ decisions }),
  });
  if (response.status === 401) throw sessionExpired();
  if (response.status === 409) throw new Error("This upload is no longer waiting for that decision. Reload the review.");
  if (!response.ok) throw new Error(`Could not send your decisions (${response.status}).`);
}
