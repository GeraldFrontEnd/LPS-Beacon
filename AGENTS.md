# LPS-Beacon: guide for AI agents and the people working with them

Gerald and Derek both work on this repository, each with an AI assistant (Claude Code, Codex or another). This
file is the shared entry point. The `work/` folder keeps progress between sessions, so nobody depends on someone
else's chat history. It follows the LPSbot approach (`AGENTS.md` + `work/`), cut down to what a two-person team needs.

## One-time setup per clone

`git config core.hooksPath .githooks`: a push to `main` without a handover entry then prints a reminder
(it never blocks; `SKIP_HANDOVER_CHECK=1 git push` silences it once). The start-of-session summary says if it's off.

## Start of a session

1. **See what changed:** `python tools/handover.py since --fetch`. It lists every commit since the last handover
   entry (yours or someone else's), which areas it touched, whether those deploy, your branch's position and the
   uncommitted files. Claude Code runs a short version automatically when a session starts
   (`.claude/settings.json`).
2. Read the **last entry** of [work/HANDOVER.md](work/HANDOVER.md), then [work/PROGRESS.md](work/PROGRESS.md).
3. If `main` moved, `git pull` before editing. Treat old notes as leads to check, not proof of current behaviour.
4. Work within what the person asked for. A next action written in a handover doesn't authorise it by itself.

## Rules (from README and Contributing; those win if they differ)

- **A push to `main` deploys to AWS** when it changes the pipeline, the API or the frontend
  (`.github/workflows/ci-cd.yml`). Nothing runs lint or tests first. Don't push, merge or deploy unless the person
  asked you to.
- **Before a commit:** `npm run lint` and `npm run build` in `LPS-Beacon-Frontend/`; backend changes also need
  `python -m unittest discover -s tests -v` in the Lambda folder you changed. Report the real results; never write
  passed for a check that wasn't run.
- **Versions and release notes:** start commit messages with `feat:` or `fix:`. For changes users should know about,
  add an entry at the end of `release-notes.json` and run `python tools/release_notes.py check`. Never edit a
  released entry. See [README: release notes](README.md#release-notes-set-the-version-number).
- **Never commit** `.env` files, spreadsheets or CSVs, real HR, cost, revenue or pipeline data, secrets, or
  `node_modules/` and `dist/`. No real figures or staff and customer names in notes, release notes or handovers.
- **API changes:** update `LPS-Beacon-Frontend/API_CONTRACT.md`. New API routes still need adding in API Gateway
  by hand.
- Preserve changes you didn't make. On Windows, discard files that only changed line endings (`git restore`).

## End of a session (the handover)

1. Run `python tools/handover.py draft`. It prints a pre-filled entry: date (Singapore time), author, the commit it
   covers (`Up to:`), the commits and files since the last entry, deploy impact and the release-notes status.
2. Fill in the `<...>` parts: what the person asked for, decisions, checks run with real results, what wasn't
   checked, what waits on a person, and **one** concrete next action.
3. Append it to the end of [work/HANDOVER.md](work/HANDOVER.md). Update [work/PROGRESS.md](work/PROGRESS.md) if the
   current objective or next actions changed. Keep entries short; link to files rather than copying them.
4. Commit the handover with the work it describes (it doesn't deploy on its own).

In Claude Code, ask for the **handover** agent (`.claude/agents/handover.md`) to do steps 1–3, or run `/handover`.
Use `/catch-up` at the start for a fuller summary than the automatic one.

**Three reminders, none of which block:** the pre-push hook on your machine, a "Handover missing" warning on the
Deploy run's summary page in GitHub Actions, and the HANDOVER GAP line in everyone's next session.

**Forgot a handover?** Nothing is lost: `since` counts from the last commit that added a handover entry, so the
next person's start-of-session summary shows a **HANDOVER GAP** line naming whose commits have no entry, and
reminds you about your own unpushed or uncommitted work. `/catch-up` can backfill a marked entry from git history.
Only the context (why, checks run, next action) is missing, so ask the author.

Commit the handover entry **in the same push** as the work: that commit then covers itself and everything before
it. Never edit the `Up to:` line of an older entry (it is the fallback before `work/HANDOVER.md` is committed).
