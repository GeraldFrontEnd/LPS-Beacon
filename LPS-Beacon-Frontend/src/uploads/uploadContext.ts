// src/uploads/uploadContext.ts
// A "context" is a shared box of data that any component can read, wherever it is on the screen.
// This one holds the list of uploaded files, so it survives when you switch to another page and back.
// This file only describes the box; UploadProvider fills it and useUploads reads it.

import { createContext } from "react";
import type { UploadBatch, UploadItem } from "../api/types";

// What every component gets when it asks for the upload list.
export interface UploadContextValue {
  items: UploadItem[]; // the chosen files, each with a status
  isUploading: boolean; // true while files are being sent
  lastBatch: UploadBatch | null; // the newest upload's folder (null in mock mode without a backend reply)
  addItems: (newItems: UploadItem[]) => void; // adds files to the list
  removeItem: (id: string) => void; // removes one file from the list
  startUpload: () => Promise<void>; // sends every file that is waiting
}

// null is the starting value; it means "no UploadProvider above this component".
export const UploadContext = createContext<UploadContextValue | null>(null);
