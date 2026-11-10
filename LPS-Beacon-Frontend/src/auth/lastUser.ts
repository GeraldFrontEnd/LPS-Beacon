// src/auth/lastUser.ts
// Remembers the email of the last person who signed in on this browser, so the sign-in page can greet them
// ("Welcome back, Goon") and fill in their email. Only the email is kept: never the password or a token.
// It lives in localStorage, so it survives signing out and closing the browser, until "Use another account"
// is pressed or the browser data is cleared.

const STORAGE_KEY = "lps-beacon:last-user";

export interface LastUser {
  email: string;
  displayName: string; // a friendly name made from the email, for the greeting
}

// Turns the part before the @ into a name: "jane.tan@lpstech.com" -> "Jane Tan", "goon@lpstech.com" -> "Goon".
// Dots, dashes and underscores become spaces; digits are dropped. Falls back to the whole email if nothing is left.
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/[0-9]+/g, " ")
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.length ? words.join(" ") : email;
}

// Reads the remembered user, or null if there is none (or storage is blocked).
export function getLastUser(): LastUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { email?: unknown };
    if (typeof saved.email !== "string" || !saved.email.includes("@")) return null;
    return { email: saved.email, displayName: nameFromEmail(saved.email) };
  } catch {
    return null;
  }
}

// Saves the email after a successful sign-in.
export function rememberLastUser(email: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ email: email.trim().toLowerCase() }));
  } catch {
    // storage blocked: the page simply won't greet the user by name next time
  }
}

// Forgets the remembered user ("Use another account").
export function forgetLastUser(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
