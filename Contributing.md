# Contributing to LPS-Beacon

This repository is the single source of truth for LPS-Beacon: the web app and the backend code. **You never need to zip the project and
send it.** Make your change, save it to GitHub, and everyone else gets it with one click.

- [How sharing works](#how-sharing-works)
- [Ways to edit](#ways-to-edit)
- [Everyday workflow](#everyday-workflow)
- [Agents: catch-up and handover](#agents-catch-up-and-handover)
- [Worked example: one session from start to finish](#worked-example-one-session-from-start-to-finish)
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
python tools/handover.py since             # what changed since the last handover (Claude Code shows this itself)
git switch -c fix/upload-error-message     # a short name describing your change

# ... edit files; the browser updates as you save ...

npm run lint                               # inside LPS-Beacon-Frontend/: quick self-check
npm run build

# end of your session: /handover in Claude Code, or python tools/handover.py draft and add it to work/HANDOVER.md

git add -A
git status                                 # check the list: no .env files, no spreadsheets
git commit -m "fix: show file name in upload error message"
git push -u origin fix/upload-error-message
```

Then open the repository on GitHub, click **Compare & pull request**, and describe what changed and why.

Tips:

- **Small, focused changes** are easier to review than one huge change.
- **Write the commit message for a teammate**: what changed and why.
- **Add a `release-notes.json` entry** (at the end, `type` `major`, `minor` or `fix`) for anything people should
  know about, then run `python tools/release_notes.py check`. The biggest new entry sets the release version (see
  [Release notes in the README](README.md#release-notes-set-the-version-number)). Never edit a released entry.
- **Start the commit message with `feat:` or `fix:`.** It sets the version when a release has no new entries.
- **Leave a handover** before you stop, and commit it in the same push as your work (see
  [Agents: catch-up and handover](#agents-catch-up-and-handover)).
- **Keep `main` working.** Every push to `main` deploys to AWS automatically, and nothing runs lint or tests first, so
  run `npm run lint` and `npm run build` before you push. If you changed the backend, also run its tests: `python -m unittest discover -s tests -v` in
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

## Agents: catch-up and handover

Each of us works with an AI assistant, and nobody can read anyone else's chat. So every session starts by finding
out what changed, and ends with a short handover note in [`work/HANDOVER.md`](work/HANDOVER.md). The full
explanation is in the [README](README.md#handovers-between-work-sessions-catch-up-and-handover); the assistants'
own rules are in [`AGENTS.md`](AGENTS.md).

| When | In Claude Code | Without Claude Code |
|---|---|---|
| **Start of a session** | Nothing to do: a summary loads by itself. Type `/catch-up` for an explanation of what changed and what's unfinished. | `python tools/handover.py since --fetch`, then read the last entry of `work/HANDOVER.md` |
| **End of a session** | `/handover`, optionally with a line on what you did and which checks passed. Review the entry it writes. | `python tools/handover.py draft`, fill in the `<...>` parts, paste it at the end of `work/HANDOVER.md` |
| **Then** | Commit the entry **in the same push** as your work. | Same |

**One-time setup per clone:**

1. Open the `LPS-Beacon` folder itself in VS Code (not beside another folder), so Claude Code loads `.claude/`.
   Accept the prompt to trust the project.
2. Make sure `python --version` works.
3. Optional push reminder: `git config core.hooksPath .githooks`.

**Rules for handover entries:**

- Write what really happened. Under "Checks run", give real results; never claim a check that wasn't run.
- No secrets, `.env` values, real figures, or staff or customer names (same as [the list below](#what-must-never-be-committed)).
- Add new entries at the end. Never edit an older entry or its `Up to:` line.
- A forgotten handover isn't lost. The next session shows a **HANDOVER GAP** line naming whose commits have no entry,
  and the Deploy run in GitHub Actions shows a **Handover missing** warning. Ask the author, or let `/catch-up` write
  a backfilled entry from git.

These files never deploy and never create a release: `AGENTS.md`, `CLAUDE.md`, `work/`, `tools/`, `.claude/` and
`.githooks/`.

---

## Worked example: one session from start to finish

**The situation:** Derek is asked to fix a bug: the Dashboard goes blank when a month has no data. Gerald worked on
the repository yesterday. Derek has never seen Gerald's changes. Every step below shows what Derek types and what
he sees. Outputs are shortened; commit IDs and versions are examples.

### Step 1. Open the project and read what changed

Derek opens VS Code → **File → Open Folder → `LPS-Beacon`**, and starts Claude Code. Without typing anything, Claude
already has this summary:

```text
## LPS-Beacon: changes since the last handover (`2f06043`), on origin/main (fetched just now)
Last handover: 2026-11-13 by Gerald: Release-note versioning and handover setup
No new commits.
Your branch `main`: 0 commit(s) not on origin/main, 2 behind it. Pull before editing.
Latest release: v1.0.0; 2 commit(s) on origin/main since it.
```

"2 behind" means Gerald's work isn't on Derek's computer yet, so he pulls first:

```bash
git switch main
git pull
```

Then he types **`/catch-up`** to find out what Gerald did and whether anything is unfinished. Claude reads the
commits and the last handover entry, and answers in plain words:

```text
Since the last handover: no new commits. Gerald's last session (13 Nov) added release-note versioning and the
handover setup; nothing deploys from it. Not checked yet: a real release with the new release notes.
Next action recorded: confirm the start-of-session summary in a new session.
Before you edit: you're up to date; create LPS-Beacon-Frontend/.env with VITE_USE_MOCK=true for local work.
```

> **New to the repository?** Type `/catch-up I'm new to the repo, include an orientation` instead. You also get what
> the app is, where each part lives, how to run it, and how deploys and releases work.

### Step 2. Make a branch and fix the bug

```bash
git switch -c fix/dashboard-empty-month
cd LPS-Beacon-Frontend
npm run dev            # opens http://localhost:5173; sign in with finance@demo.com / demo123
```

Derek finds the bug in `src/dashboard/`, fixes it, and checks it in the browser with an empty month.

### Step 3. Run the checks before committing

```bash
npm run lint           # → no errors
npm run build          # → built in 6.2s
cd ..
```

He changed only the frontend, so the backend tests aren't needed. If he had changed `LPS-Beacon_Backend/`, he'd also
run `python -m unittest discover -s tests -v` in that Lambda's folder.

### Step 4. Say what users will notice (release notes)

People will notice this fix, so Derek adds an entry **at the end** of `entries` in `release-notes.json`:

```json
{
  "id": "dashboard-empty-month",
  "type": "fix",
  "text": "The Dashboard no longer goes blank on a month with no data."
}
```

```bash
python tools/release_notes.py check
# release-notes.json: OK. 1 new entry since v1.0.0; next bump: fix
#   + [fix] dashboard-empty-month
```

`fix` means the next release will be `v1.0.1`. A new feature would be `minor` (`v1.1.0`), and a big new feature
`major` (`v2.0.0`).

### Step 5. Write the handover

Derek types:

```text
/handover fixed the Dashboard going blank on an empty month; lint and build passed; not checked on the live site yet
```

Claude appends this to the end of `work/HANDOVER.md` and shows it to him:

```markdown
## 2026-11-14 — Dashboard empty-month fix

- Author: Derek (with Claude Code). Time: 16:20 SGT.
- Up to: `2f06043` on `origin/main`. Commits read since the last entry: none.
- Objective: the Dashboard went blank for a month with no data.
- Changed: frontend: LPS-Beacon-Frontend/src/dashboard/... ; release notes: release-notes.json.
- Deploy and release: Deploys on push to main: frontend. release-notes.json: 1 new entry; next bump: fix
- Checks run: npm run lint: no errors. npm run build: succeeded. release_notes.py check: OK.
- Not checked: the live site after the deploy.
- Waiting on a person: none.
- Next action: after the deploy, open the live Dashboard on an empty month and confirm it renders.
```

Derek reads it and corrects anything that's wrong. It's his note, not Claude's.

### Step 6. Commit everything together and push the branch

The fix, the release-note entry and the handover go in **one commit**. That way the handover covers the work, and
the release title shows the right message.

```bash
git add -A
git status             # check: only the dashboard file(s), release-notes.json, work/HANDOVER.md. No .env, no spreadsheets
git commit -m "fix: dashboard blank on a month with no data"
git push -u origin fix/dashboard-empty-month
```

He pushed a branch, not `main`, so nothing deploys yet and the push reminder stays quiet. On GitHub he clicks
**Compare & pull request**. Gerald reviews the **Files changed** tab and merges.

### Step 7. What happens after the merge (automatic)

- **Deploy:** the Deploy run in **Actions** sees a frontend change, builds the app and publishes it.
- **Handover check:** the run summary shows no "Handover missing" warning, because the merge carried a
  `work/HANDOVER.md` entry.
- **Release:** a new release appears under **Releases**:

```text
LPS-Beacon v1.0.1 (bug fixes): fix: dashboard blank on a month with no data

## What's new
### Fixes
- The Dashboard no longer goes blank on a month with no data.
## Deployed components
- Frontend (S3 + CloudFront)
## Changes
- fix: dashboard blank on a month with no data (a1b2c3d) by Derek
**Full Changelog:** .../compare/v1.0.0...v1.0.1
```

Derek opens the live site, checks an empty month, and the "Not checked" item is done. He can mention it in his next
handover.

### Step 8. The next morning, Gerald starts a session

Gerald's summary picks up where Derek left off:

```text
Last handover: 2026-11-14 by Derek: Dashboard empty-month fix
No new commits.
Your branch `main`: 0 commit(s) not on origin/main, 1 behind it. Pull before editing.
```

Gerald runs `git pull`, types `/catch-up`, and sees Derek's fix, its release `v1.0.1`, and the next action Derek
left. Nobody had to ask anybody anything.

### What if Derek had forgotten Step 5?

- **If he pushed straight to `main`** (with the push reminder on), his terminal says:
  `Handover reminder: this push sends 1 commit(s) to main without a work/HANDOVER.md entry.`
  It still pushes; nothing is blocked.
- **The Deploy run** shows a **Handover missing** warning on its summary page.
- **Gerald's next session** shows:
  `HANDOVER GAP: no handover entry covers these 1 commit(s) yet: Derek (1).`
  Gerald can ask Derek, or type `/catch-up` and accept its offer to write a **backfilled** entry from the git
  history. That entry is marked as backfilled, and anything it can't know (checks, next action) says "not recorded".

### The same session at a glance

| Step | Command | Why |
|---|---|---|
| 1 | Open the folder, read the summary, `git pull`, `/catch-up` | Know what changed and start from the latest version |
| 2 | `git switch -c fix/...`, then edit | Work on your own branch, not `main` |
| 3 | `npm run lint`, `npm run build` (plus backend tests if needed) | Nothing checks for you before a deploy |
| 4 | Add a `release-notes.json` entry, `python tools/release_notes.py check` | Sets the version and the What's new text |
| 5 | `/handover ...`, then review the entry | The next person knows why, what was checked and what's next |
| 6 | One commit (`fix:` or `feat:`), push the branch, open a pull request | The handover covers the work; a teammate reviews it |
| 7 | Merge → automatic deploy and release; check the live site | Confirms it works for real |

---

## Getting other people's changes

```bash
git switch main
git pull
cd LPS-Beacon-Frontend && npm ci   # only needed if package.json or package-lock.json changed
```

In GitHub Desktop: **Fetch origin**, then **Pull origin**.

To see what those changes were and why, type `/catch-up` in Claude Code, or run `python tools/handover.py since`.

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
| No "what changed" summary when Claude Code starts | Open the `LPS-Beacon` folder itself and start a new session; `/hooks` should list a `SessionStart` entry. |
| `/catch-up` or `/handover` isn't offered | `git pull` so `.claude/` is present, then start a new session. |
| "HANDOVER GAP" at the start of a session | Someone pushed without a handover. Ask them, or let `/catch-up` backfill an entry. |
