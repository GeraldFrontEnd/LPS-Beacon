// src/api/client.ts
// Every call to the backend lives in this file. When your teammates give you the
// real endpoints, this is (almost) the only file you will need to change.

// "import type" tells TypeScript these are only types, so they disappear when the app is built.
import type {
  SendMessageRequest,
  SendMessageResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  ProjectSummary,
  CapacityPlan,
} from "./types";

// import.meta.env reads values from the .env file. Vite only exposes names that start with VITE_.
// Values are always strings, so we compare to the text "true" instead of the boolean true.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

// The base URL of API Gateway, for example https://abc123.execute-api.ap-southeast-1.amazonaws.com
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

// A tiny helper that pauses for a number of milliseconds (used to fake network delay).
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Used only by the fake (mock) data below. Decides whether a login token belongs to a finance user.
// It reads the groups inside the token, which imitates what the real backend will do.
function tokenIsFinance(token?: string): boolean {
  if (!token) return false;
  if (token === "mock-token-finance") return true; // the practice finance account
  try {
    // A token has three parts separated by dots; the middle part holds the user's details, encoded as text.
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload)) as { "cognito:groups"?: string[] };
    return (claims["cognito:groups"] ?? []).some((g) => g.toLowerCase() === "finance");
  } catch {
    return false; // anything unreadable counts as "not finance"
  }
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
  const response = await fetch(`${requireApiUrl()}/chat`, {
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

  const response = await fetch(`${requireApiUrl()}/upload-url`, {
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

// ---- Added for the dashboard ----

// Loads the project staffing overview.
export async function getDashboard(token?: string): Promise<ProjectSummary[]> {
  if (USE_MOCK) {
    await wait(500);
    // Imitates the backend: only a finance login gets cost figures.
    // The real backend must make this decision too, because hiding things in the screen is not security.
    const includeCost = tokenIsFinance(token);
    const rows = [
      { id: "a", name: "Project A", needed: 12, assigned: 8, cost: 96000 },
      { id: "b", name: "Project B", needed: 6, assigned: 6, cost: 54000 },
      { id: "c", name: "Project C", needed: 10, assigned: 4, cost: 40000 },
      { id: "d", name: "Project D", needed: 5, assigned: 7, cost: 63000 },
    ];
    // Remove "cost" from every row, and add it back as costPerMonth only for finance.
    return rows.map(({ cost, ...row }) => (includeCost ? { ...row, costPerMonth: cost } : row));
  }

  const response = await fetch(`${requireApiUrl()}/dashboard`, {
    headers: buildHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Could not load the dashboard (${response.status}).`);
  }
  return (await response.json()) as ProjectSummary[];
}

// ---- Added for the Analysis page ----

// Loads the capacity plan the system generated. Finance only.
// With VITE_USE_MOCK=true it returns a made-up sample plan so the Dashboard and Analysis screens can be previewed.
// TODO: the backend does not generate the plan yet, so otherwise this returns an empty plan and the screens show
// no data. When it does, call GET /capacity-plan here (same pattern as getDashboard) and return its JSON.
// A 403 should become the message "You don't have access to this data."
export async function getCapacityPlan(token?: string): Promise<CapacityPlan> {
  if (USE_MOCK) {
    await wait(400);
    if (!tokenIsFinance(token)) throw new Error("You don't have access to this data.");
    // Loaded only when needed, so the sample code is not part of a normal build's main file.
    const { buildSampleCapacityPlan } = await import("./sampleCapacityPlan");
    return buildSampleCapacityPlan();
  }
  void token; // will be sent as the login token once the real call exists
  return { values: {}, bandRates: {} };
}
