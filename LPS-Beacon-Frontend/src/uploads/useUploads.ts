// src/uploads/useUploads.ts
// A small shortcut so any component can write: const { items } = useUploads();

import { useContext } from "react";
import { UploadContext } from "./uploadContext";

export function useUploads() {
  const context = useContext(UploadContext); // read the shared upload list
  if (!context) {
    // This only happens if a developer forgets to wrap the app in <UploadProvider>.
    throw new Error("useUploads must be used inside <UploadProvider>.");
  }
  return context;
}
