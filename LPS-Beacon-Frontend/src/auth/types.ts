// src/auth/types.ts
// Describes the shapes used by login. No logic here, only types.

// The three kinds of users. A Role can only be one of these three strings.
export type Role = "hr" | "pm" | "finance";

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
