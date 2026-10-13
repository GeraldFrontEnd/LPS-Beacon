// src/auth/useAuth.ts
// A small shortcut so any component can write: const { user } = useAuth();

import { useContext } from "react";
import { AuthContext } from "./authContext";

export function useAuth() {
  const context = useContext(AuthContext); // read the shared login box
  if (!context) {
    // This only happens if a developer forgets to wrap the app in <AuthProvider>.
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}
