# Contributing to LPS-Beacon FrontEnd

This repository is the single source of truth for the LPS-Beacon frontend. **You never need to zip the project and
send it.** Make your change, save it to GitHub, and everyone else gets it with one click.

- [How sharing works](#how-sharing-works)
- [Ways to edit](#ways-to-edit)
- [Everyday workflow](#everyday-workflow)
- [Getting other people's changes](#getting-other-peoples-changes)
- [Seeing changes without installing anything](#seeing-changes-without-installing-anything)
- [What must never be committed](#what-must-never-be-committed)
- [Setting up the repository (owner, one time)](#setting-up-the-repository-owner-one-time)
- [Troubleshooting](#troubleshooting)

---

## How sharing works

| Word | Meaning |
|---|---|
| **Repository** | The project folder, stored on GitHub, with its full history. |
| **Branch** | Your own copy of the work. `main` is the official version; do your edits on a branch. |
| **Commit** | A saved set of changes with a short message. |
| **Push** | Send your commits to GitHub. |
| **Pull request (PR)** | A request to merge your branch into `main`. Teammates review it, and automatic checks run. |
| **Pull** | Download other people's latest changes to your computer. |

The loop is always the same: **branch → edit → commit → push → pull request → review → merge.**

---

## Ways to edit

Pick whichever suits you. All of them end in the same place: a branch on GitHub.

### 1. GitHub Codespaces (nothing to install, runs the app)

1. On the repository page choose **Code → Codespaces → Create codespace on main**.
2. Wait for it to finish. It installs the dependencies and starts the app in **mock mode** (no AWS needed).
3. A live preview opens. Edit any file in `frontend/src/` and the preview updates as you save.
4. Use the Source Control panel to commit and push.

Codespaces has a free monthly allowance on personal accounts. Repositories owned by an organisation use that
organisation's billing, so ask your administrator if it is not available.

### 2. Your own computer

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+ and [Git](https://git-scm.com). If you prefer a visual tool
instead of commands, use [GitHub Desktop](https://desktop.github.com).

```bash
git clone https://github.com/<owner>/lps-beacon.git
cd lps-beacon/frontend
npm ci                       # installs the exact locked versions
cp .env.example .env         # Windows (Command Prompt): copy .env.example .env
npm run dev                  # opens at http://localhost:5173 and reloads when you save
```

Sign in with a practice account such as `finance@demo.com` / `demo123` (see [`frontend/README.md`](frontend/README.md)).

### 3. The browser editor (quick text edits, does not run the app)

Open any file on GitHub and press the pencil icon, or press the `.` key on the repository page for a browser-based
VS Code. Make the edit and commit it to a new branch. Good for wording, documentation and small fixes.

---

## Everyday workflow

```bash
git switch main
git pull                                   # start from the latest version
git switch -c fix/upload-error-message     # a short name describing your change

# ... edit files; the browser updates as you save ...

npm run lint                               # inside frontend/: quick self-check
npm run build

git add -A
git status                                 # check the list: no .env files, no spreadsheets
git commit -m "Show file name in upload error message"
git push -u origin fix/upload-error-message
```

Then open the repository on GitHub, click **Compare & pull request**, and fill in the short template.

Tips:

- **Small, focused changes** are easier to review than one huge change.
- **Write the commit message for a teammate**: what changed and why.
- **Keep `main` working.** The automatic check (CI) runs lint, type-check and build on every pull request. If it shows a
  red cross, click it, read the error, fix it and push again; the check re-runs by itself.

### Which files to edit

| To change… | Edit |
|---|---|
| A screen | `frontend/src/pages/` |
| Menus, chat box, file list | `frontend/src/components/` |
| Backend calls and mock data | `frontend/src/api/client.ts`, `frontend/src/api/types.ts` |
| Who can see which page | `frontend/src/auth/permissions.ts` |
| Sign-in behaviour | `frontend/src/auth/authService.ts` |
| Styling | `frontend/src/index.css` |
| What the backend must provide | `frontend/API_CONTRACT.md` (update it whenever an API call changes) |

---

## Getting other people's changes

```bash
git switch main
git pull
cd frontend && npm ci        # only needed if package.json or package-lock.json changed
```

In GitHub Desktop: **Fetch origin**, then **Pull origin**. In Codespaces: run `git pull` in the terminal.

To be told when something changes, use **Watch → Custom → Pull requests / Pushes** on the repository page.

---

## Seeing changes without installing anything

- **Review a change:** every pull request has a **Files changed** tab showing exactly which lines were added and
  removed, and a conversation tab for comments.
- **History:** the **Commits** page lists every change, who made it and when. Click a commit to see the difference.
- **Run a branch:** open a Codespace on that branch (Code → Codespaces), or `git switch <branch>` locally.

### Optional live preview for everyone

A workflow in `.github/workflows/preview-pages.yml` can publish the latest `main` to GitHub Pages in **mock mode**
(practice accounts and fake data only, no AWS, no secrets). It is off by default. To switch it on:

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   name `ENABLE_PAGES_PREVIEW`, value `true`.
3. Push to `main` (or run the workflow from the **Actions** tab). The link appears in the workflow summary and under
   Settings → Pages.

Pages for a **private** repository needs a paid GitHub plan, and the published site may be publicly reachable. Only
enable it if a public mock demo is acceptable. Nothing in it is real: the build uses mock mode and contains no
Cognito or API settings.

---

## What must never be committed

- **`.env` files** (they hold your Cognito and API settings). Only `.env.example` and `.env.deploy.example` are
  committed. `.gitignore` already blocks the real ones.
- **Real planning data**: HR, headcount, cost, revenue or pipeline spreadsheets (`.xlsx`, `.xls`, `.csv`). `.gitignore`
  blocks them. Anonymised test files go in `sample-data/anonymised/` only.
- **Secrets of any kind**: passwords, access keys, tokens, `.pem` files.
- **`node_modules/` and `dist/`**: they are rebuilt from `package-lock.json`.

Before every commit, run `git status` and read the list. If you commit something sensitive by mistake, tell the
repository owner straight away. Deleting it in a later commit is **not** enough, because it stays in the history. The
credential must be rotated and the file removed from the whole history.

---

## Setting up the repository (owner, one time)

1. Create an **empty** repository on GitHub (no README or license added). Start it as **private** because of the HR and
   finance context.
2. Push the project (from the project folder):

   ```bash
   git init
   git add .
   git status          # check the list: no .env, node_modules, dist or spreadsheets
   git commit -m "Initial commit: LPS-Beacon frontend and architecture docs"
   git branch -M main
   git remote add origin https://github.com/<owner>/lps-beacon.git
   git push -u origin main
   ```

3. **Settings → Collaborators** (or Teams): invite people with the **Write** role.
4. **Settings → Branches → Add branch ruleset** for `main` (recommended):
   - Require a pull request before merging.
   - Require status checks to pass, and select **Lint, type-check and build** (it appears after the first CI run).
5. Optional: enable the [live preview](#optional-live-preview-for-everyone).
6. Choose a license and add a `LICENSE` file when you are ready.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm ci` fails with an engine or version error | Use Node 22 (`nvm use`, or install from nodejs.org). Vite needs 20.19+ or 22.12+. |
| The page is blank or sign-in says Cognito is not set up | Check `frontend/.env` exists (copy from `.env.example`) and restart `npm run dev`. |
| `git push` is rejected | Someone else pushed first. Run `git pull`, fix any conflict, then push again. |
| The CI check fails but it works on my computer | Run `npm ci && npm run lint && npm run build` in `frontend/`. CI uses the locked versions and Node 22. |
| I changed a setting in `.env` and nothing happened | Restart `npm run dev`; Vite only reads `.env` on start. |
| Merge conflict markers (`<<<<<<<`) in a file | Two people edited the same lines. Keep the correct version, delete the markers, then `git add` and commit. |
| `git status` shows an `.env` or a spreadsheet | Do not commit it. Check the file name; `.gitignore` should hide these. Ask the owner if it appears anyway. |
