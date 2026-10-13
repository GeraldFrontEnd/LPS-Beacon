# API contract: what the web app expects from the backend

Give this file to whoever builds the backend. The exact request and response shapes live in
`src/api/types.ts`. Every call to our API sends the header
`Authorization: <Cognito ID token>`. Decide together whether the API Gateway authorizer expects the raw token
or `Bearer <token>`; the web app sends the token as-is.

This is the contract the web app **uses today**. The full target design (pipeline runs, scenarios, chat history)
is in the [root README](../README.md#api-reference), under "Planned additions".

## Endpoints

| Method and path | Request body | Response |
|---|---|---|
| `POST /chat` | `{ sessionId, message }` | `{ reply }` |
| `POST /upload-url` | `{ fileName, contentType }` | `{ uploadUrl, key }` |
| `GET /dashboard` | none | `ProjectSummary[]` (see below) |
| `GET /pnl` | none | `PnlRow[]` (see below), finance only |

**Upload:** after `POST /upload-url`, the browser does `PUT <uploadUrl>` with the file as the body and the
same `Content-Type` that was sent in the request. `uploadUrl` is a pre-signed S3 URL. The file goes straight to S3;
this second request does **not** carry the login token. The app uploads files one at a time.

**Dashboard:** `ProjectSummary` is `{ id, name, needed, assigned, costPerMonth? }`.
Only include `costPerMonth` when the caller is in the `finance` group. The web app hides the column when
it is missing, but the backend must be the one that withholds it.

**P&L:** `PnlRow` is `{ id, name, revenue, manpowerCost, otherCosts }` for the month, one row per project.
Return `403` for anyone not in the `finance` group. The web app works out profit and margin itself.
The backend needs a source for revenue and other costs (the manpower data alone does not contain them).

## Cognito

- Groups: `hr`, `pm`, `finance`. The web app reads the role from the token's `cognito:groups` claim.
- The web app needs the User Pool ID, App Client ID and region (set in `.env`; see `.env.example`).
- The App Client must be a **public client with no client secret** (it runs in the browser).
- If the user pool requires MFA, note the limitation under "Known limitations" in the [root README](../README.md#known-limitations).

## CORS (otherwise the browser blocks the calls)

- API Gateway: allow the web app's origin, headers `Authorization` and `Content-Type`, methods `GET`, `POST`, `OPTIONS`.
- S3 data bucket: allow `PUT` from the web app's origin with header `Content-Type`.

## Role rules to confirm

| Rule | Where it is set |
|---|---|
| Upload page allowed for `hr` and `finance` | `src/auth/permissions.ts` |
| P&L page allowed for `finance` only | `src/auth/permissions.ts` |
| Upload files: CSV or Excel (`.csv`, `.xlsx`, `.xls`), up to 20 MB each | `src/pages/UploadPage.tsx` |
| Cost figures have no currency symbol yet | `src/pages/DashboardPage.tsx` |

These only control what the **screens** show. The backend must enforce the same rules.

## Switching the web app from mock to real

Mock mode needs no AWS account. It is controlled by two settings in `.env`:

| Setting | `true` | `false` |
|---|---|---|
| `VITE_USE_MOCK` | Chat, upload, dashboard and P&L use fake data from `src/api/client.ts` | Calls the real API at `VITE_API_URL` |
| `VITE_USE_MOCK_AUTH` | Practice accounts (no AWS) | Real Amazon Cognito sign-in |

If `VITE_USE_MOCK_AUTH` is left out, sign-in follows `VITE_USE_MOCK`. This lets you test real sign-in while the other
screens still show fake data.

To go fully real:

1. In `.env`: set `VITE_USE_MOCK=false` and `VITE_USE_MOCK_AUTH=false`, then fill in `VITE_API_URL`,
   `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`.
2. Before a production release, delete `DEMO_ACCOUNTS` in `src/auth/authService.ts` and the practice-accounts
   box in `src/pages/LoginPage.tsx`.
