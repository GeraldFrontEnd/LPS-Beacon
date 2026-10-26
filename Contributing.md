# Contributing to LPS-Beacon

This repository is the single source of truth for LPS-Beacon: the web app and the backend code. **You never need to zip the project and
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
| **Pull request (PR)** | A request to merge your branch into `main`. Teammates review it before it is merged. |
| **Pull** | Download other people's latest changes to your computer. |

The loop is always the same: **branch → edit → commit → push → pull request → review → merge.**

---

## Ways to edit

Pick whichever suits you. Both end in the same place: a branch on GitHub.

### 1. Your own computer

You need [Node.js](https://nodejs.org) 22, 24 or 26 on a patched release (at least 22.23.4, 24.22.1 or 26.12.1, see CSA alert
AL-2026-154) and [Git](https://git-scm.com). If you prefer a visual tool instead of commands, use
[GitHub Desktop](https://desktop.github.com).

```bash
git clone https://github.com/GeraldFrontEnd/LPS-Beacon.git
cd LPS-Beacon/LPS-Beacon-Frontend
npm ci                       # installs the exact locked versions
npm run dev                  # opens at http://localhost:5173 and reloads when you save
```

Before `npm run dev`, create `LPS-Beacon-Frontend/.env`. For offline work it only needs the line `VITE_USE_MOCK=true`;
the other settings are listed in [`LPS-Beacon-Frontend/README.md`](LPS-Beacon-Frontend/README.md#configuration).
Sign in with a practice account such as `finance@demo.com` / `demo123`.

For the backend you need Python 3.12; see
[`LPS-Beacon_Backend/lambda-forecastpipeline/README.md`](LPS-Beacon_Backend/lambda-forecastpipeline/README.md).

### 2. The browser editor (quick text edits, does not run the app)

Open any file on GitHub and press the pencil icon, or press the `.` key on the repository page for a browser-based
VS Code. Make the edit and commit it to a new branch. Good for wording, documentation and small fixes.

---

## Everyday workflow

```bash
git switch main
git pull                                   # start from the latest version
git switch -c fix/upload-error-message     # a short name describing your change

# ... edit files; the browser updates as you save ...

npm run lint                               # inside LPS-Beacon-Frontend/: quick self-check
npm run build

git add -A
git status                                 # check the list: no .env files, no spreadsheets
git commit -m "Show file name in upload error message"
git push -u origin fix/upload-error-message
```

Then open the repository on GitHub, click **Compare & pull request**, and describe what changed and why.

Tips:

- **Small, focused changes** are easier to review than one huge change.
- **Write the commit message for a teammate**: what changed and why.
- **Keep `main` working.** There is no automatic check (CI) yet, so run `npm run lint` and `npm run build` before you
  push. If you changed the backend, also run its tests: `python -m unittest discover -s tests -v` in
  `LPS-Beacon_Backend/lambda-forecastpipeline/`.
- **Line endings:** the repository stores LF. On Windows, Git can turn files into CRLF, and they then show as changed
  even though you didn't edit them. Don't commit those: discard them (`git restore <file>`, or **Discard changes** in
  GitHub Desktop).

### Which files to edit

| To change… | Edit |
|---|---|
| A screen | `LPS-Beacon-Frontend/src/pages/` |
| Menus, chat box, file list, activity bell | `LPS-Beacon-Frontend/src/components/` |
| The upload review (Conflicts, Forecast, Matching) | `LPS-Beacon-Frontend/src/review/` |
| The Dashboard | `LPS-Beacon-Frontend/src/dashboard/` |
| The capacity plan's rows and columns | `LPS-Beacon-Frontend/src/analysis/capacityPlanLayout.ts` |
| Backend calls and mock data | `LPS-Beacon-Frontend/src/api/client.ts`, `LPS-Beacon-Frontend/src/api/types.ts` |
| Who can see which page | `LPS-Beacon-Frontend/src/auth/permissions.ts` |
| Sign-in behaviour | `LPS-Beacon-Frontend/src/auth/authService.ts` |
| Styling | `LPS-Beacon-Frontend/src/index.css` |
| API routes and the chat agent | `LPS-Beacon_Backend/lambda-api/lambda_function.py` |
| Capacity plan calculations | `LPS-Beacon_Backend/lambda-api/capacity_plan.py` |
| Cleaning, review, forecast, publishing | `LPS-Beacon_Backend/lambda-forecastpipeline/pipeline/` |
| Matching logic | `LPS-Beacon_Backend/lambda-forecastpipeline/matching_python_script.py` |
| What the backend must provide | `LPS-Beacon-Frontend/API_CONTRACT.md` (update it whenever an API call changes) |

---

## Getting other people's changes

```bash
git switch main
git pull
cd LPS-Beacon-Frontend && npm ci   # only needed if package.json or package-lock.json changed
```

In GitHub Desktop: **Fetch origin**, then **Pull origin**.

To be told when something changes, use **Watch → Custom → Pull requests / Pushes** on the repository page.

---

## Seeing changes without installing anything

- **Review a change:** every pull request has a **Files changed** tab showing exactly which lines were added and
  removed, and a conversation tab for comments.
- **History:** the **Commits** page lists every change, who made it and when. Click a commit to see the difference.
- **Run a branch:** switch to it (`git switch <branch>`, or the branch menu in GitHub Desktop), then `npm run dev`.

---

## What must never be committed

- **`.env` and `.env.deploy`** (they hold your Cognito, API and deploy settings). `.gitignore` already blocks them.
- **Real planning data**: HR, headcount, cost, revenue or pipeline spreadsheets (`.xlsx`, `.xls`, `.csv`). `.gitignore`
  blocks Excel and CSV files everywhere.
- **Secrets of any kind**: passwords, access keys, tokens, `.pem` files.
- **`node_modules/` and `dist/`**: they are rebuilt from `package-lock.json`.

Before every commit, run `git status` and read the list. If you commit something sensitive by mistake, tell the
repository owner straight away. Deleting it in a later commit is **not** enough, because it stays in the history. The
credential must be rotated and the file removed from the whole history.

---

## Setting up the repository (owner, one time)

Already done: the repository is `GeraldFrontEnd/LPS-Beacon`. For reference:

1. **Settings → Collaborators** (or Teams): invite people with the **Write** role.
2. **Settings → Branches → Add branch ruleset** for `main` (recommended): require a pull request before merging.
3. Choose a license and add a `LICENSE` file when you are ready. None has been chosen yet.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm ci` fails with an engine or version error | Install Node 22, 24 or 26 from nodejs.org (a patched release). Vite needs 20.19+ or 22.12+. |
| The page is blank or sign-in says Cognito is not set up | Check `LPS-Beacon-Frontend/.env` exists with `VITE_USE_MOCK=true` (offline) or the Cognito and API values, then restart `npm run dev`. |
| `git push` is rejected | Someone else pushed first. Run `git pull`, fix any conflict, then push again. |
| A file shows as changed but you didn't edit it | Windows turned its LF line endings into CRLF. Discard it (`git restore <file>`, or **Discard changes** in GitHub Desktop). |
| I changed a setting in `.env` and nothing happened | Restart `npm run dev`; Vite only reads `.env` on start. |
| Merge conflict markers (`<<<<<<<`) in a file | Two people edited the same lines. Keep the correct version, delete the markers, then `git add` and commit. |
| `git status` shows an `.env` or a spreadsheet | Do not commit it. Check the file name; `.gitignore` should hide these. Ask the owner if it appears anyway. |
