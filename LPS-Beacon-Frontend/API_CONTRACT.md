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
| `GET /capacity-plan` | none | `CapacityPlan` (see below). **Planned:** the web app does not call it yet |
| `PATCH /capacity-plan` | `{ rowId, columnKey, value }` | the whole recalculated `CapacityPlan`. **Planned:** the web app does not call it yet |
| `GET /headcount` | none | `HeadcountBreakdown` (see below). **Planned:** the web app does not call it yet |

**Upload:** after `POST /upload-url`, the browser does `PUT <uploadUrl>` with the file as the body and the
same `Content-Type` that was sent in the request. `uploadUrl` is a pre-signed S3 URL. The file goes straight to S3;
this second request does **not** carry the login token. The app uploads files one at a time.

**Capacity plan (Dashboard charts and Analysis tab):** `CapacityPlan` is `{ values }`, defined in `src/api/types.ts`. The screen's rows and
columns are fixed in `src/analysis/capacityPlanLayout.ts` (copied from `Capacity_Plan_template.xlsx`); the backend only sends numbers,
looked up by id: `values[rowId][columnKey]`, for example `values["joiners:b7"]["Oct'26"]`. Money is in plain dollars (the screen shows millions, "$ in M") and percentages are fractions (0.15 = 15%).
Missing or `null` means an empty cell. The plan includes the quarter (`Q1'26`) and year (`FY'26`, `FY'27`) columns.
Reject callers who are not signed in. The web app does no calculations on these numbers; it only formats them.

**Editing the capacity plan:** the Analysis tab lets people edit the cells that are inputs, not formulas (see `isEditableCell` in
`src/analysis/capacityPlanLayout.ts`): Joiners, Leavers and Billable UR % per band for every month, Current HC per band for the
first month, and Revenue and Standard Working days for every month. The web app sends one edited cell with `PATCH /capacity-plan`
and shows the plan that comes back. The backend must validate the value, recalculate every formula cell (ending headcount,
revenue, cost, margin, quarter and year totals) and return the whole plan. Quarter and year totals are not editable.

**Headcount today (Dashboard boxes):** `HeadcountBreakdown` is `{ asOf, permanent: { regular, supplementalOther, supplementalRetiree }, secondment }`,
defined in `src/api/types.ts`. These are counts of active staff on the `asOf` date (from the HC by HR file), split by employment type:
Regular Employee, Supplemental - Other and Supplemental - Retiree make up permanent staff; Secondment is separate. The web app adds up
the permanent and overall totals itself.

## Cognito

- Every user must be in one of two Cognito groups: `restricted` (sees only the Chat page) or `finance_hr` (sees every page).
  The web app reads the group from `cognito:groups` in the ID token; a user in neither group cannot sign in.
- The backend must check the same groups: only `finance_hr` may call `/upload-url`, `/capacity-plan` and `/headcount`.
  For `restricted` users, `/chat` should call Bedrock with a guardrail that limits what they can ask.
- The web app needs the User Pool ID, App Client ID and region (set in `.env`; see `.env.example`).
- The App Client must be a **public client with no client secret** (it runs in the browser).
- If the user pool requires MFA, note the limitation under "Known limitations" in the [root README](../README.md#known-limitations).

## CORS (otherwise the browser blocks the calls)

- API Gateway: allow the web app's origin, headers `Authorization` and `Content-Type`, methods `GET`, `POST`, `OPTIONS`.
- S3 data bucket: allow `PUT` from the web app's origin with header `Content-Type`.

## Rules to confirm

| Rule | Where it is set |
|---|---|
| Upload files: CSV or Excel (`.csv`, `.xlsx`, `.xls`), up to 20 MB each | `src/pages/UploadPage.tsx` |
| Capacity plan money is labelled "$ in M", but the template's Band Rates sheet says SGD | `src/analysis/capacityPlanLayout.ts` |

The web app hides pages by role, but that is only a convenience: the backend must restrict the data itself.


## Switching the web app from mock to real

Mock mode needs no AWS account. It is controlled by two settings in `.env`:

| Setting | `true` | `false` |
|---|---|---|
| `VITE_USE_MOCK` | Chat and upload use fake data from `src/api/client.ts` | Calls the real API at `VITE_API_URL` |
| `VITE_USE_MOCK_AUTH` | Practice accounts (no AWS) | Real Amazon Cognito sign-in |

If `VITE_USE_MOCK_AUTH` is left out, sign-in follows `VITE_USE_MOCK`. This lets you test real sign-in while the other
screens still show fake data.

To go fully real:

1. In `.env`: set `VITE_USE_MOCK=false` and `VITE_USE_MOCK_AUTH=false`, then fill in `VITE_API_URL`,
   `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`.
2. Before a production release, delete `DEMO_ACCOUNTS` in `src/auth/authService.ts` and the practice-accounts
   box in `src/pages/LoginPage.tsx`.
