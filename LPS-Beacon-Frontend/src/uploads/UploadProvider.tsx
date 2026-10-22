// src/uploads/UploadProvider.tsx
// Keeps the upload list ABOVE the pages. Pages are thrown away when you leave them, which used to
// wipe the list; this provider stays alive the whole time you are signed in, so the list survives.

import { useState } from "react";
import type { ReactNode } from "react"; // ReactNode = "anything React can display"
import { uploadFile } from "../api/client";
import type { UploadBatch, UploadItem } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { useReview } from "../review/useReview";
import { UploadContext } from "./uploadContext";
import type { UploadContextValue } from "./uploadContext";

interface UploadProviderProps {
  children: ReactNode; // whatever is placed between <UploadProvider> and </UploadProvider>
}

// The part that really holds the list. It is not exported; only UploadProvider below uses it.
function UploadState({ children }: UploadProviderProps) {
  const { token } = useAuth(); // the login token, sent with each upload request
  const { startProcessing } = useReview(); // starts the review of the uploaded files

  const [items, setItems] = useState<UploadItem[]>([]); // the chosen files, each with a status
  const [isUploading, setIsUploading] = useState(false); // true while an upload run is in progress
  // The newest upload's folder, for following the pipeline's progress (GET /pipeline/uploads/{date}/{batchId}).
  const [lastBatch, setLastBatch] = useState<UploadBatch | null>(null);

  // Changes one item in the list. "patch" holds only the fields to change.
  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  // Adds new files to the end of the list.
  function addItems(newItems: UploadItem[]) {
    setItems((prev) => [...prev, ...newItems]);
  }

  // Removes one item from the list.
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  // Uploads every file that is waiting (new ones, and ones that failed before), one after another.
  // If you leave the Upload page meanwhile, this keeps running, because it lives here, not in the page.
  async function startUpload({ review = true }: { review?: boolean } = {}) {
    setIsUploading(true);

    const toUpload = items.filter((i) => i.status === "ready" || i.status === "error");
    const uploadedNames: string[] = []; // files that made it, for the review that follows
    // One id for the whole upload: the backend puts these files in one folder, so the forecast pipeline
    // runs once, after the last of them.
    const batchId = crypto.randomUUID();
    let batch: UploadBatch | null = null; // the folder the backend put this upload in

    for (const item of toUpload) {
      updateItem(item.id, { status: "uploading", error: undefined }); // show "Uploading…"
      try {
        batch = (await uploadFile(item.file, token ?? undefined, batchId, review)) ?? batch; // one file at a time
        if (batch) setLastBatch(batch);
        updateItem(item.id, { status: "done" });
        uploadedNames.push(item.file.name);
      } catch (err) {
        // One failed file doesn't stop the others; we record the reason and carry on.
        updateItem(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed. Try again.",
        });
      }
    }

    setIsUploading(false);
    // The system now checks, cleans and forecasts the new files; the review panel shows its findings.
    // Without review it only checks and stores them; the panel says when that is done.
    startProcessing(uploadedNames, batch, { review });
  }

  // The data every component will be able to read.
  const value: UploadContextValue = { items, isUploading, lastBatch, addItems, removeItem, startUpload };

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export default function UploadProvider({ children }: UploadProviderProps) {
  const { user } = useAuth();

  // The key makes React throw away the old list and start an empty one whenever a different person
  // signs in, or someone signs out. That way nobody ever sees another person's uploaded files.
  return <UploadState key={user?.email ?? "signed-out"}>{children}</UploadState>;
}
