# Handovers

One entry per work session, oldest first; add new ones at the end. Read the last entry before starting.
`python tools/handover.py draft` pre-fills an entry; `python tools/handover.py since` lists what changed after
the last commit that added an entry, and flags a HANDOVER GAP for commits no entry covers. Commit each entry in
the same push as its work. Never edit an older entry's `Up to:` line. No secrets, real figures or
staff and customer names.

## 2026-11-13 — Release-note versioning and handover setup

- Author: Gerald (with Claude Code). Time: 14:40 SGT.
- Up to: `2f06043` on `origin/main`. Commits read: `2f06043` Add release-note-driven versioning, `3e8a007` Document automated deploys and releases.
- Objective: version releases from a `release-notes.json` like LPSbot's, show a Full Changelog link and descriptive release titles, then add an LPSbot-style handover setup that detects new changes.
- Changed (in `2f06043`): `release-notes.json`, `tools/release_notes.py`, the `changes` and `release` jobs in `.github/workflows/ci-cd.yml`, README, Contributing, `docs/ci-cd-setup.md`. The `v1.0.0` release notes on GitHub were edited by hand to add their Full Changelog link.
- Changed (uncommitted): `AGENTS.md`, `CLAUDE.md`, `work/PROGRESS.md`, `work/HANDOVER.md`, `tools/handover.py`, `.claude/settings.json` (session-start hook), `.claude/agents/handover.md`, `.claude/skills/catch-up/`, `.claude/skills/handover/`.
- Deploy and release: nothing here deploys. `release-notes.json` has no entries yet; the next release is versioned from commit prefixes until one is added.
- Checks run: `release_notes.py` scenarios in a scratch repo (bump levels, notes, rejected edits, bad JSON, duplicate ids): as expected. The release step run locally with publishing disabled: correct version, title, notes and link. `handover.py since` and `draft` on this repo: correct commits, areas and marker fallback. The hook command, run from another folder: works, and survives a failed fetch.
- Not checked: the Deploy run for `2f06043` (GitHub API unreachable from this machine at the time); a real release with the new title and notes; the session-start hook inside a new Claude Code session.
- Waiting on a person: none.
- Next action: commit the handover setup, then open a new Claude Code session in the repo and confirm the start-of-session summary appears.
