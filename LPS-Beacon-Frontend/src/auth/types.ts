// src/auth/types.ts
// Describes the shapes used by login. No logic here, only types.

// The two kinds of account, named after the user's Cognito group:
//  - "restricted": can only use the Chat page (mainly project managers)
//  - "finance_hr": can open every page
export type Role = "restricted" | "finance_hr";

// The person who is logged in.
export interface AuthUser {
  email: string;
  name: string;
  role: Role;
}

// What we keep after a successful login: who the user is, plus a token that proves it to the backend.
export interface AuthSession {
  user: AuthUser;
  token: string;
}

// What every component gets when it asks "who is logged in, and how do I log in or out?".
export interface AuthContextValue {
  user: AuthUser | null; // null means nobody is logged in
  token: string | null; // null means nobody is logged in
  isLoading: boolean; // true while the app checks whether an earlier login is still valid
  signIn: (email: string, password: string) => Promise<void>; // throws an Error if login fails
  signOut: () => Promise<void>;
}
