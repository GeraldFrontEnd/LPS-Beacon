// src/lib/pageState.ts
// Remembers what a page looked like (filters picked, rows opened, the chat that was open, a half-typed question) for
// 30 minutes, so leaving a page and coming back puts it back as it was (4 Nov 2026).
//
// Kept in this browser tab's sessionStorage: it is a convenience only. A new tab, a private window or blocked storage
// simply starts the page fresh, and nothing on the server depends on it. Every read and write is guarded. Signing out
// clears it (clearPageState, called by AuthProvider), so the next person on the same browser starts clean.

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

const PREFIX = "lps-beacon.page.";
export const PAGE_STATE_TTL_MS = 30 * 60 * 1000;

interface Saved<T> {
  at: number;
  value: T;
}

export function loadPageState<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Saved<T>;
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > PAGE_STATE_TTL_MS) {
      window.sessionStorage.removeItem(PREFIX + key);
      return fallback;
    }
    return saved.value;
  } catch {
    return fallback;
  }
}

export function savePageState<T>(key: string, value: T): void {
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value } satisfies Saved<T>));
  } catch {
    // storage full or blocked: the page just won't be remembered
  }
}

export function clearPageState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // nothing to clear
  }
}

// useState that is remembered for 30 minutes under `key`. The value must be JSON (no Sets or Maps).
export function usePageState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    loadPageState(key, typeof initial === "function" ? (initial as () => T)() : initial)
  );
  useEffect(() => {
    savePageState(key, value);
  }, [key, value]);
  return [value, setValue];
}
