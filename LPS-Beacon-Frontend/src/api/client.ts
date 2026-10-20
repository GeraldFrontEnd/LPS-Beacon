// src/api/client.ts
// Every call to the backend lives in this file. When your teammates give you the
// real endpoints, this is (almost) the only file you will need to change.

// "import type" tells TypeScript these are only types, so they disappear when the app is built.
import type {
  SendMessageRequest,
  SendMessageResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  CapacityPlan,
  CapacityPlanEdit,
  HeadcountBreakdown,
} from "./types";

// import.meta.env reads values from the .env file. Vite only exposes names that start with VITE_.
// Values are always strings, so we compare to the text "true" instead of the boolean true.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
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
  sessions: "/sessions", // GET list chats, POST start a chat (planned)
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`, // PATCH rename, DELETE (planned)
  sessionMessages: (id: string) => `/sessions/${encodeURIComponent(id)}/messages`, // GET (planned)
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
    headers: buildHeaders(token),
    body: JSON.stringify(req),
  });

  // response.ok is false for errors like 401 (not logged in) or 500 (server problem).
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
    return { uploadUrl: "mock://upload", key: `raw/${req.fileName}` };
  }

  const response = await fetch(`${requireApiUrl()}${API_ROUTES.uploadUrl}`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(`Could not get an upload link (${response.status}).`);
  }

  return (await response.json()) as UploadUrlResponse;
}

// Uploads one file: step 1 (get the link) and step 2 (send the file to that link).
// Promise<void> means it returns nothing; it either finishes or throws an error.
export async function uploadFile(file: File, token?: string): Promise<void> {
  // Some computers don't report a type for CSV files, so we fall back to a generic one.
  // The SAME value is used in both steps; if they differ, S3 can reject the upload.
  const contentType = file.type || "application/octet-stream";

  const { uploadUrl } = await getUploadUrl({ fileName: file.name, contentType }, token);

  // Mock mode: pretend to upload, and fail on purpose if the file name contains "fail".
  // This lets you test the error state on the upload page.
  if (USE_MOCK) {
    await wait(1000);
    if (file.name.toLowerCase().includes("fail")) {
      throw new Error("Mock upload failed (the file name contains the word fail).");
    }
    return;
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
