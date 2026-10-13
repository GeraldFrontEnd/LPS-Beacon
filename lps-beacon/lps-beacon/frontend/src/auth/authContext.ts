// src/auth/authContext.ts
// A "context" is a shared box of data that any component can read without
// being passed it through every parent. Here it holds the login information.
// This file only creates the empty box; AuthProvider fills it and useAuth reads it.

import { createContext } from "react";
import type { AuthContextValue } from "./types";

// null is the starting value; it means "no AuthProvider above this component".
export const AuthContext = createContext<AuthContextValue | null>(null);
