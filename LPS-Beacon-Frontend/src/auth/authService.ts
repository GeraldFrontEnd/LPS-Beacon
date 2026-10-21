// src/auth/authService.ts
// All login logic lives here, separate from the screens. It has two modes:
//   - mock auth: a fake login with practice accounts (no AWS needed)
//   - real auth: Amazon Cognito, through the aws-amplify library
// The mode is chosen in .env, so the rest of the app never needs to know which one is active.

import { Amplify } from "aws-amplify";
import {
  fetchAuthSession, // reads the current login (and refreshes it if it expired)
  signIn as amplifySignIn, // renamed so it doesn't clash with our own signIn below
  signOut as amplifySignOut,
} from "aws-amplify/auth";
import type { AuthSession, Role } from "./types";

// VITE_USE_MOCK_AUTH overrides the mode for login only. If it is missing, we follow VITE_USE_MOCK.
// This lets you use a REAL login while the other screens still show fake data.
const mockAuthSetting = import.meta.env.VITE_USE_MOCK_AUTH as string | undefined;
export const IS_MOCK = (mockAuthSetting ?? import.meta.env.VITE_USE_MOCK) === "true";

// The two Cognito values you copied from the AWS console.
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;

// Tell Amplify which Cognito user pool to talk to. Runs once, when this file is first loaded.
if (!IS_MOCK && USER_POOL_ID && CLIENT_ID) {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: USER_POOL_ID, userPoolClientId: CLIENT_ID } },
  });
}

// ---------- Mock mode (practice accounts) ----------

const STORAGE_KEY = "manpower-session"; // where the fake login is remembered (cleared when the tab closes)

interface DemoAccount {
  email: string;
  password: string;
  name: string;
  role: Role;
}

// Two practice accounts, one per role. Delete these when you no longer need mock login.
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "restricted@demo.com", password: "demo123", name: "Demo Restricted", role: "restricted" },
  { email: "finance@demo.com", password: "demo123", name: "Demo Finance/HR", role: "finance_hr" },
];

// Pause helper to imitate a slow network.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fake login: checks the practice accounts.
async function mockSignIn(email: string, password: string): Promise<AuthSession> {
  await wait(500);
  const account = DEMO_ACCOUNTS.find(
    (a) => a.email === email.trim().toLowerCase() && a.password === password
  );
  if (!account) throw new Error("Email or password is incorrect.");
  const session: AuthSession = {
    user: { email: account.email, name: account.name, role: account.role },
    token: `mock-token-${account.role}`, // a fake token
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); // objects must be saved as text
  return session;
}

// ---------- Real mode (Amazon Cognito) ----------

// Turns the list of Cognito groups into one role. If someone is in several groups, the most powerful wins.
// Group names are compared in lowercase, so "Finance_HR" and "finance_hr" both count.
function pickRole(groups: string[]): Role | null {
  const lower = groups.map((g) => g.toLowerCase());
  if (lower.includes("finance_hr")) return "finance_hr";
  if (lower.includes("restricted")) return "restricted";
  return null; // not in any group we know
}

// Reads the current Cognito login and turns it into our own AuthSession shape.
// Returns null when nobody is logged in.
async function readCognitoSession(): Promise<AuthSession | null> {
  const { tokens } = await fetchAuthSession(); // tokens is undefined when nobody is logged in
  const idToken = tokens?.idToken; // the ID token carries the user's email and groups
  if (!idToken) return null;

  // "cognito:groups" is where Cognito lists the groups the user belongs to.
  const rawGroups = idToken.payload["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string") // keep only text entries
    : [];

  const role = pickRole(groups);
  if (!role) {
    throw new Error(
      "Your account is not in a group yet (restricted or finance_hr). Ask an administrator to add you to one."
    );
  }

  const email = typeof idToken.payload.email === "string" ? idToken.payload.email : "";
  // The token text is what we send to the backend in the Authorization header.
  return { user: { email, name: email, role }, token: idToken.toString() };
}

// Turns Cognito's technical errors into messages a person can understand.
function friendlyError(err: unknown): Error {
  const name = err instanceof Error ? err.name : "";
  // Both "wrong password" and "no such user" get the same message, so nobody can probe which emails exist.
  if (name === "NotAuthorizedException" || name === "UserNotFoundException") {
    return new Error("Email or password is incorrect.");
  }
  if (name === "NetworkError") {
    return new Error("Could not reach the sign-in service. Check your connection.");
  }
  if (err instanceof Error) return err; // keep our own messages as they are
  return new Error("Could not sign in. Try again.");
}

// Real login with Cognito.
async function cognitoSignIn(email: string, password: string): Promise<AuthSession> {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error(
      "Cognito is not set up in this app. Add VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID to .env, then restart the dev server."
    );
  }
  try {
    await amplifySignOut().catch(() => undefined); // clear any half-finished earlier login first
    const result = await amplifySignIn({ username: email.trim(), password });

    // Cognito can ask for an extra step (for example choosing a new password). We don't support those yet.
    if (!result.isSignedIn) {
      const step = result.nextStep.signInStep;
      if (step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        throw new Error(
          "This account must choose a new password first. Ask an administrator to set a permanent password."
        );
      }
      throw new Error(`An extra sign-in step is required (${step}). This app does not support it yet.`);
    }

    const session = await readCognitoSession();
    if (!session) throw new Error("Sign-in finished but no session was found. Try again.");
    return session;
  } catch (err) {
    await amplifySignOut().catch(() => undefined); // don't leave a half login behind
    throw friendlyError(err);
  }
}

// ---------- What the rest of the app uses ----------

// Reads a saved login, if there is one. Used when the page loads, so a refresh doesn't log you out.
export async function loadSession(): Promise<AuthSession | null> {
  if (IS_MOCK) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as AuthSession) : null;
      // A login saved before the roles changed (for example "finance") no longer counts.
      return saved && DEMO_ACCOUNTS.some((a) => a.role === saved.user?.role) ? saved : null;
    } catch {
      return null;
    }
  }
  if (!USER_POOL_ID || !CLIENT_ID) return null;
  try {
    return await readCognitoSession();
  } catch {
    return null; // an unreadable or expired login counts as "not logged in"
  }
}

// Logs in. Returns the session, or throws an Error with a message to show.
export async function signIn(email: string, password: string): Promise<AuthSession> {
  return IS_MOCK ? mockSignIn(email, password) : cognitoSignIn(email, password);
}

// ---------- Keeping the login token valid ----------

// Cognito ID tokens last about an hour. Amplify keeps a longer-lived refresh token (30 days by default) and can use
// it to get a new ID token without asking the user to sign in again.
const REFRESH_MARGIN_SECONDS = 5 * 60; // renew when less than 5 minutes are left, so a request never carries a dying token

// Returns a valid ID token for an API call, renewing it first if it is about to expire.
// Returns null when the user is signed out or the login can no longer be renewed (for example the refresh token has
// expired or the user was disabled); the caller then has to send them back to the sign-in page.
export async function getFreshToken(): Promise<string | null> {
  if (IS_MOCK) return (await loadSession())?.token ?? null;
  try {
    let { tokens } = await fetchAuthSession();
    const expires = tokens?.idToken?.payload.exp;
    if (!tokens?.idToken || typeof expires !== "number" || expires - Date.now() / 1000 < REFRESH_MARGIN_SECONDS) {
      ({ tokens } = await fetchAuthSession({ forceRefresh: true }));
    }
    return tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

// A message for the sign-in page explaining why the user was signed out. It is read once, then forgotten.
const SIGN_OUT_NOTICE_KEY = "lps-beacon:sign-out-notice";

export function setSignOutNotice(message: string): void {
  try {
    sessionStorage.setItem(SIGN_OUT_NOTICE_KEY, message);
  } catch {
    // storage blocked: the user still lands on the sign-in page, just without the explanation
  }
}

export function takeSignOutNotice(): string | null {
  try {
    const message = sessionStorage.getItem(SIGN_OUT_NOTICE_KEY);
    sessionStorage.removeItem(SIGN_OUT_NOTICE_KEY);
    return message;
  } catch {
    return null;
  }
}

// Logs out.
export async function signOut(): Promise<void> {
  if (IS_MOCK) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  await amplifySignOut().catch(() => undefined); // ignore errors: we want to end up logged out either way
}
