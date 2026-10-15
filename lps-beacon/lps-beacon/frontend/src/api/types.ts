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
}

// The backend answers with the link.
export interface UploadUrlResponse {
  uploadUrl: string; // a temporary S3 address we can send the file to directly
  key: string; // the path the file will have inside the S3 bucket
}

// ---- Added for the dashboard ----

// One row on the dashboard: how staffed a project is.
export interface ProjectSummary {
  id: string;
  name: string;
  needed: number; // people the project needs
  assigned: number; // people already assigned
  costPerMonth?: number; // optional: the backend must only send this to finance users
}

// ---- Added for the Analysis page (the capacity plan) ----

// The numbers of the capacity plan. The layout (which rows and columns exist) lives in
// src/analysis/capacityPlanLayout.ts; the backend only sends values, looked up by id.
export interface CapacityPlan {
  // rowId -> column key -> number. For example values["joiners:b7"]["Oct'26"] = 2.
  // A missing entry or null means "no value", and the cell is shown empty.
  values: Record<string, Record<string, number | null>>;
  // band id (for example "b9") -> day rates in SGD.
  bandRates: Record<string, { fy26: number | null; fy27: number | null }>;
}
