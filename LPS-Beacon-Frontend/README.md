# LPS-Beacon frontend

The browser front end for LPS-Beacon: chat with the Resource Planning Forecast assistant, upload planning files,
and view charts and the generated capacity plan.

Built with React 19, TypeScript, Vite, React Router and AWS Amplify (Cognito sign-in only).

> New here? Start with the [root README](../README.md) for the full architecture, and [Contributing.md](../Contributing.md) for how to edit and share changes. This file covers only the frontend.

## Quick start (no AWS account needed)

Requires **Node.js 22, 24 or 26** on a patched release: at least 22.23.4, 24.22.1 or 26.12.1 (CSA alert AL-2026-154). Vite
accepts 20.19+ or 22.12+, but Node 20 no longer gets security fixes. Check with `node -v`.

Create a file named `.env` in this folder containing the line `VITE_USE_MOCK=true`, then:

```bash
cd LPS-Beacon-Frontend
npm ci
npm run dev
```

Open the address shown in the terminal (usually http://localhost:5173). With `VITE_USE_MOCK=true` the app runs in
**mock mode**: sign-in uses practice accounts and every screen shows fake data, so you can work on the interface
without a backend.

| Practice account | Password | Role |
|---|---|---|
| `finance@demo.com` | `demo123` | Finance/HR (every page) |
| `restricted@demo.com` | `demo123` | Restricted |

These are fake accounts that only exist in mock mode.

## Configuration

Settings live in `.env` in this folder. There is no template file: add the variables you need from this table.
Restart `npm run dev` after changing them.

| Variable | Purpose |
|---|---|
| `VITE_USE_MOCK` | `true` = fake data for chat and upload, plus a made-up sample capacity plan for the Dashboard charts and the Analysis tab. Anything else, or not set = call the real API at `VITE_API_URL`. |
| `VITE_USE_SAMPLE_PLAN` | `true` = only the capacity plan (Dashboard charts and Analysis tab) uses a made-up sample plan; chat, upload and sign-in stay as configured. For previewing before the backend generates a real plan. |
| `VITE_USE_SAMPLE_REVIEW` | `true` = after an upload, the review panel on the Upload page (conflicts, forecast, matching) runs on sample data built from the cleaned files, even when uploads go to the real S3. Also on when `VITE_USE_MOCK=true`. For demos without the pipeline. |
| `VITE_USE_MOCK_AUTH` | Sign-in only. `false` = real Amazon Cognito, `true` = practice accounts. If omitted, follows `VITE_USE_MOCK`. |
| `VITE_API_URL` | Base URL of API Gateway. Not needed in mock mode. |
| `VITE_COGNITO_USER_POOL_ID` | Cognito user pool ID (AWS console). |
| `VITE_COGNITO_CLIENT_ID` | Cognito app client ID. Must be a public client with no secret. |

> **Never put secrets in a `VITE_` variable.** Vite copies these values into the built JavaScript, which every
> visitor can read. The pool ID and client ID are safe because they are public identifiers. API keys, passwords and
> client secrets are not.

`.env` is git-ignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built app locally |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Build, upload to S3 and clear the CloudFront cache (see below) |

## Pages

There are two kinds of account, taken from the user's Cognito group: `restricted` and `finance_hr`.

| Page | Route | Restricted | Finance/HR |
|---|---|:---:|:---:|
| Chat | `/` | Yes | Yes |
| Dashboard (headcount, utilisation and margin from the capacity plan) | `/dashboard` | No | Yes |
| Upload (CSV or Excel, up to 20 MB each) | `/upload` | No | Yes |
| Analysis (the capacity plan the system generates) | `/analysis` | No | Yes |

Rules are set in `src/auth/permissions.ts`. These only control what the **screens** show. The backend must enforce
the same rules, especially for cost and capacity plan data.

## Project structure

```
LPS-Beacon-Frontend/
├── src/
│   ├── analysis/       # capacity plan layout (capacityPlanLayout.ts), number formatting, CSV export
│   ├── api/            # client.ts (every backend call, mock + real), types.ts, sample capacity plan
│   ├── auth/           # Cognito / practice sign-in, session context, roles (permissions.ts)
│   ├── charts/         # bar, line and heatmap charts
│   ├── chats/          # chat history and export
│   ├── components/     # NavBar, Sidebar, ActivityBell, MessageList, MessageInput, FileList, dialogs
│   ├── dashboard/      # Dashboard sections, KPI boxes, capacity charts, insights
│   ├── pages/          # ChatPage, DashboardPage, UploadPage, AnalysisPage, LoginPage
│   ├── review/         # the upload review drawer: Conflicts, Forecast, Matching
│   ├── theme/
│   ├── uploads/        # upload queue shared across pages
│   ├── App.tsx         # routes and the sign-in guard
│   └── main.tsx
├── public/             # favicon and icons
├── scripts/deploy.mjs  # build + publish script
└── API_CONTRACT.md     # what this app expects from the backend
```

Not in Git: `.env` and `.env.deploy` (your settings), `node_modules/` and `dist/`.

The backend contract is in [`API_CONTRACT.md`](API_CONTRACT.md).

## Deploying the web app

The app is a static site: build it, upload `dist/` to a private S3 bucket, and serve it through CloudFront.

1. Install and sign in to the [AWS CLI](https://aws.amazon.com/cli/) (`aws configure` or `aws sso login`).
2. Create `.env.deploy` in this folder (one `KEY=VALUE` per line) with `FRONTEND_BUCKET` (the web bucket,
   `lps-beacon-frontend`) and `CLOUDFRONT_DISTRIBUTION_ID`, plus `AWS_REGION` if it isn't `ap-southeast-1`.
   `.env.deploy` is git-ignored, so account details never reach the repository.
3. Preview what will run, then deploy:
   ```bash
   node scripts/deploy.mjs --dry-run
   npm run deploy
   ```

The script checks the bucket, distribution and region values before running any command.

**If the AWS CLI only works in WSL2** (the Windows installer needs admin rights): run `npm run build` in
PowerShell, then from this folder in Ubuntu:

```bash
aws s3 sync dist s3://lps-beacon-frontend --delete --region ap-southeast-1 --profile lps
aws cloudfront create-invalidation --distribution-id <ID from .env.deploy> --paths "/*" --profile lps
```

When the SSO session expires, run `aws sso login --profile lps`.

Single-page apps need one CloudFront setting: add custom error responses that return `/index.html` with status 200
for 403 and 404, so deep links such as `/dashboard` still load.

## Known limitations

- **MFA setup is not supported in the sign-in form yet.** If the Cognito user pool requires MFA and the user has not
  set up an authenticator app, sign-in stops with "An extra sign-in step is required
  (CONTINUE_SIGN_IN_WITH_TOTP_SETUP)". The same applies to `CONFIRM_SIGN_IN_WITH_TOTP_CODE`. See
  `src/auth/authService.ts`. To fix it, either replace the form with Amplify's `<Authenticator>` component, or handle
  those steps with `confirmSignIn()` and a QR code screen.
- **Users who must change their password** (admin-created accounts) are told to ask an administrator to set a
  permanent password.
- **Charts inside chat answers and what-if scenarios** are not built yet. (The chat history sidebar is built.)
- **No mobile layout.**
- **Practice accounts** (`DEMO_ACCOUNTS`) should be removed before a production release.
