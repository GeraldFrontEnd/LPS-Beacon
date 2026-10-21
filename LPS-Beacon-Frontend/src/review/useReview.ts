// src/review/useReview.ts
// A small shortcut so any component can write: const { stage } = useReview();

import { useContext } from "react";
import { ReviewContext } from "./reviewContext";

export function useReview() {
  const context = useContext(ReviewContext);
  if (!context) {
    // This only happens if a developer forgets to wrap the app in <ReviewProvider>.
    throw new Error("useReview must be used inside <ReviewProvider>.");
  }
  return context;
}
