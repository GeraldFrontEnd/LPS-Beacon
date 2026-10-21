// src/auth/AuthProvider.tsx
// Wraps the whole app, keeps track of who is logged in, and shares it through AuthContext.

import { useEffect, useState } from "react";
import type { ReactNode } from "react"; // ReactNode = "anything React can display"
import { AuthContext } from "./authContext";
import {
  getFreshToken,
  loadSession,
  setSignOutNotice,
  signIn as serviceSignIn,
  signOut as serviceSignOut,
} from "./authService";
import { setAuthHandlers } from "../api/client";
import type { AuthContextValue, AuthSession } from "./types";

interface AuthProviderProps {
  children: ReactNode; // whatever is placed between <AuthProvider> and </AuthProvider>
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null); // the current login, or null
  const [isLoading, setIsLoading] = useState(true); // true until we have checked for an earlier login

  // Runs once when the app starts: look for a login that is still valid (for example after a refresh).
  useEffect(() => {
    let cancelled = false; // stops us updating state if the component has already gone away
    loadSession()
      .then((saved) => {
        if (!cancelled) setSession(saved);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false); // we now know the answer, logged in or not
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every API call asks for a fresh token just before it is sent (see src/api/client.ts). If the login can no longer
  // be renewed, or the API answers 401, the user is signed out and the sign-in page explains why.
  useEffect(() => {
    setAuthHandlers(getFreshToken, () => {
      setSignOutNotice("Your session has expired. Please sign in again.");
      setSession(null);
      void serviceSignOut();
    });
    return () => setAuthHandlers(null, null);
  }, []);

  // Logs in using the service, then remembers the result so the screens update.
  async function signIn(email: string, password: string) {
    const newSession = await serviceSignIn(email, password); // throws if the login is wrong
    setSession(newSession);
  }

  // Logs out. We clear the screen state first so the UI reacts immediately.
  async function signOut() {
    setSession(null);
    await serviceSignOut();
  }

  // The data every component will be able to read.
  const value: AuthContextValue = {
    user: session?.user ?? null,
    token: session?.token ?? null,
    isLoading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
