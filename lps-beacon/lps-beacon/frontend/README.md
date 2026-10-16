# LPS-Beacon frontend

The browser front end for LPS-Beacon: chat with the Resource Planning Forecast assistant, upload planning files,
and view project staffing and (for finance) the generated capacity plan.

Built with React 19, TypeScript, Vite, React Router and AWS Amplify (Cognito sign-in only).

> New here? Start with the [root README](../README.md) for the full architecture, and [CONTRIBUTING.md](../CONTRIBUTING.md) for how to edit and share changes. This file covers only the frontend.

## Quick start (no AWS account needed)

Requires **Node.js 20.19+ or 22.12+**. The repo includes an `.nvmrc` (Node 22); if you use nvm, run `nvm use`.

```bash
cd frontend
npm install
cp .env.example .env        # Windows (Command Prompt): copy .env.example .env
npm run dev
```

Open the address shown in the terminal (usually http://localhost:5173). With the default settings the app runs in
**mock mode**: sign-in uses practice accounts and every screen shows fake data, so you can work on the interface
without a backend.

| Practice account | Password | Role |
|---|---|---|
| `hr@demo.com` | `demo123` | HR |
| `pm@demo.com` | `demo123` | Project manager |
| `finance@demo.com` | `demo123` | Finance |

These are fake accounts that only exist in mock mode.

## Configuration

Settings live in `.env` (copied from `.env.example`). Restart `npm run dev` after changing them.

| Variable | Purpose |
|---|---|
| `VITE_USE_MOCK` | `true` = fake data for chat, upload and dashboard, plus a made-up sample capacity plan for the Dashboard charts and the Analysis tab. `false` = call the real API. |
| `VITE_USE_MOCK_AUTH` | Sign-in only. `false` = real Amazon Cognito, `true` = practice accounts. If omitted, follows `VITE_USE_MOCK`. |
| `VITE_API_URL` | Base URL of API Gateway. Not needed in mock mode. |
| `VITE_COGNITO_USER_POOL_ID` | Cognito user pool ID (AWS console). |
| `VITE_COGNITO_CLIENT_ID` | Cognito app client ID. Must be a public client with no secret. |

> **Never put secrets in a `VITE_` variable.** Vite copies these values into the built JavaScript, which every
> visitor can read. The pool ID and client ID are safe because they are public identifiers. API keys, passwords and
> client secrets are not.

`.env` is git-ignored. Only `.env.example` is committed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built app locally |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Build, upload to S3 and clear the CloudFront cache (see below) |

## Roles and pages

The role comes from the user's Cognito group (`hr`, `pm` or `finance`).

| Page | Route | HR | Project manager | Finance |
|---|---|:---:|:---:|:---:|
| Chat | `/` | Yes | Yes | Yes |
| Dashboard (people needed, assigned and open per project) | `/dashboard` | Yes | Yes | Yes, plus monthly cost |
| Upload (CSV or Excel, up to 20 MB each) | `/upload` | Yes | No | Yes |
| Analysis (the capacity plan the system generates; read only) | `/analysis` | No | No | Yes |

Rules are set in `src/auth/permissions.ts`. These only control what the **screens** show. The backend must enforce
the same rules, especially for cost and capacity plan data.

## Project structure

```
frontend/
├── src/
│   ├── api/            # client.ts (all backend calls, mock + real) and types.ts
│   ├── auth/           # Cognito/mock sign-in, session context, role permissions
│   ├── components/     # NavBar, RequireAuth, MessageList, MessageInput, FileList
│   ├── pages/          # ChatPage, DashboardPage, UploadPage, AnalysisPage, LoginPage
│   ├── uploads/        # upload queue shared across pages
│   ├── App.tsx         # routes and role guards
│   └── main.tsx
├── public/             # favicon and icons
├── scripts/deploy.mjs  # build + publish script
├── API_CONTRACT.md     # what this app expects from the backend
├── .nvmrc              # Node version (22)
├── .env.example        # settings template (copy to .env)
└── .env.deploy.example # deploy settings template (copy to .env.deploy)
```

The backend contract is in [`API_CONTRACT.md`](API_CONTRACT.md).

## Deploying the web app

The app is a static site: build it, upload `dist/` to a private S3 bucket, and serve it through CloudFront.

1. Install and sign in to the [AWS CLI](https://aws.amazon.com/cli/) (`aws configure` or `aws sso login`).
2. Copy the deploy settings template and fill it in:
   ```bash
   cp .env.deploy.example .env.deploy     # Windows (Command Prompt): copy .env.deploy.example .env.deploy
   ```
   Set `FRONTEND_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID`. `.env.deploy` is git-ignored, so account details never
   reach the repository.
3. Preview what will run, then deploy:
   ```bash
   node scripts/deploy.mjs --dry-run
   npm run deploy
   ```

The script checks the bucket, distribution and region values before running any command.

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
- **Chat history sidebar, charts and what-if scenarios** are part of the design but are not built in this app yet.
- **Practice accounts** (`DEMO_ACCOUNTS`) should be removed before a production release.
