"""Detect what changed in LPS-Beacon since the last handover, and draft the next handover entry.

The last entry in work/HANDOVER.md records the commit it covers ("- Up to: `abc1234`"). Everything after
that commit is new to whoever picks the work up next. Standard library and git only; reads, never writes.

  python tools/handover.py since [--fetch] [--brief]   # what changed since the last handover
  python tools/handover.py draft [--fetch]             # a pre-filled entry to finish and append

--fetch runs `git fetch` first (15 s limit, failures ignored) so teammates' pushes to origin/main show up.
"""

import argparse
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from fnmatch import fnmatchcase
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HANDOVER = ROOT / "work" / "HANDOVER.md"
SGT = timezone(timedelta(hours=8))  # Asia/Singapore, no tzdata needed
MARKER = re.compile(r"^- Up to: `([0-9a-f]{7,40})`", re.M)

FE = "LPS-Beacon-Frontend/"
PIPE = "LPS-Beacon_Backend/lambda-forecastpipeline/"
# Same groups as the `changes` job in .github/workflows/ci-cd.yml: these deploy and make a release.
DEPLOYS = {
    "pipeline": [PIPE + p for p in ("Dockerfile", ".dockerignore", "requirements.txt", "lambda_function.py",
                                    "matching_script.py", "matching_python_script.py", "pipeline/*")],
    "api": ["LPS-Beacon_Backend/lambda-api/*.py"],
    "frontend": [FE + p for p in ("src/*", "public/*", "index.html", "LPSLogo.avif", "package.json",
                                  "package-lock.json", "vite.config.ts", "tsconfig*.json")],
}
OTHER = [  # first match wins; none of these deploy
    ("release notes", ["release-notes.json"]),
    ("CI/CD", [".github/*"]),
    ("agent and handover", ["AGENTS.md", "CLAUDE.md", "work/*", ".claude/*", "tools/handover.py"]),
    ("tools", ["tools/*"]),
    ("backend tests", ["LPS-Beacon_Backend/*/tests/*"]),
    ("docs", ["*.md", "docs/*", "*.txt"]),
    ("frontend, not deployed", [FE + "*"]),
    ("backend, not deployed", ["LPS-Beacon_Backend/*"]),
]


def git(*args, check=False):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip() if r.returncode == 0 else ""


def area(path):
    for name, pats in DEPLOYS.items():
        # api is *.py directly in lambda-api/, not its tests/ folder
        if name == "api":
            if path.startswith("LPS-Beacon_Backend/lambda-api/") and path.endswith(".py") and path.count("/") == 2:
                return name
        elif any(fnmatchcase(path, p) for p in pats):
            return name
    for name, pats in OTHER:
        if any(fnmatchcase(path, p) for p in pats):
            return name
    return "other"


def last_marker():
    if not HANDOVER.exists():
        return ""
    found = MARKER.findall(HANDOVER.read_text(encoding="utf-8"))
    for sha in reversed(found):
        if git("rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}"):
            return sha
    return ""


def is_ancestor(a, b):
    return subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=ROOT, capture_output=True).returncode == 0


def last_entry():
    """Date, title and author of the newest entry, for the "last handover" line."""
    if not HANDOVER.exists():
        return None
    text = HANDOVER.read_text(encoding="utf-8")
    heads = list(re.finditer(r"^## (\d{4}-\d{2}-\d{2}) — (.+)$", text, re.M))
    if not heads:
        return None
    h = heads[-1]
    author = re.search(r"^- Author: ([^.(\n]+)", text[h.end():], re.M)
    return h.group(1), h.group(2).strip(), (author.group(1).strip() if author else "not recorded")


def upstream():
    return "origin/main" if git("rev-parse", "--verify", "--quiet", "origin/main") else "HEAD"


def collect(fetch):
    fetched = None
    if fetch:
        try:
            fetched = subprocess.run(["git", "fetch", "--quiet", "--tags", "origin"], cwd=ROOT,
                                     capture_output=True, timeout=15).returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            fetched = False
    marker = last_marker()
    up = upstream()
    # Covered = up to the last commit that added a handover entry (it covers itself and everything before it).
    # The "Up to:" marker is the fallback while work/HANDOVER.md is not committed yet.
    hcommit = git("log", "-1", "--format=%h", up, "--", "work/HANDOVER.md")
    if hcommit and (not marker or is_ancestor(marker, hcommit)):
        base, base_kind = hcommit, "commit"
    elif marker:
        base, base_kind = marker, "marker"
    else:
        base = git("describe", "--tags", "--abbrev=0", "--match", "v*", up) or f"{up}~10"
        base_kind = "none"
    me = git("config", "user.name")
    unpushed = [l for l in git("log", f"{up}..HEAD", "--no-merges", "--pretty=%h %s").splitlines() if l]         if up != "HEAD" else []
    commits = [line.split("\x1f") for line in
               git("log", f"{base}..{up}", "--no-merges", "--date=format:%d %b", "--pretty=%h\x1f%ad\x1f%an\x1f%s").splitlines()
               if line]
    files = [f for f in git("diff", "--name-only", f"{base}..{up}").splitlines() if f]
    groups = {}
    for f in files:
        groups.setdefault(area(f), []).append(f)
    local = [l for l in subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True,
                                       text=True).stdout.splitlines() if l.strip()]
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    ahead_behind = git("rev-list", "--left-right", "--count", f"HEAD...{up}") if up != "HEAD" else ""
    tag = git("describe", "--tags", "--abbrev=0", "--match", "v*", up)
    unreleased = git("rev-list", "--count", f"{tag}..{up}") if tag else ""
    notes = subprocess.run([sys.executable, str(ROOT / "tools" / "release_notes.py"), "check"], cwd=ROOT,
                           capture_output=True, text=True)
    branches = []
    if up != "HEAD":
        refs = git("for-each-ref", "refs/remotes/origin", "--sort=-committerdate",
                   "--format=%(refname:short)%(authorname)%(committerdate:relative)%(committerdate:unix)")
        now = datetime.now(timezone.utc).timestamp()
        for line in refs.splitlines():
            name, author, rel, ts = (line.split("") + ["", "", "", "0"])[:4]
            if name in ("origin/main", "origin/HEAD", "origin") or now - float(ts or 0) > 30 * 86400:
                continue
            ahead = git("rev-list", "--count", f"{up}..{name}")
            if ahead and ahead != "0":
                branches.append((name.removeprefix("origin/"), author, ahead, rel))
    hooks_on = git("config", "core.hooksPath") == ".githooks"
    entry_open = any(l[3:].strip().strip('"') in ("work/HANDOVER.md", "work/") for l in local)
    return dict(branches=branches, hooks_on=hooks_on, fetched=fetched, marker=marker, base=base, base_kind=base_kind, me=me, unpushed=unpushed,
                entry_open=entry_open, last=last_entry(), up=up, commits=commits, groups=groups, local=local,
                branch=branch, ahead_behind=ahead_behind, tag=tag, unreleased=unreleased,
                notes=(notes.stdout or notes.stderr).strip())


def deploy_line(groups):
    hit = [n for n in DEPLOYS if n in groups]
    return ("Deploys on push to main: " + ", ".join(hit)) if hit else "Nothing here deploys (no pipeline, API or frontend files)."


def since(c, brief):
    out = []
    since_txt = {"commit": f"the last handover (`{c['base']}`)", "marker": f"the last handover (`{c['base']}`)",
                 "none": f"`{c['base']}` (no handover yet)"}[c["base_kind"]]
    fetch_txt = {None: "not fetched", True: "fetched just now", False: "fetch failed; may be stale"}[c["fetched"]]
    out.append(f"## LPS-Beacon: changes since {since_txt}, on {c['up']} ({fetch_txt})")
    if c["last"]:
        out.append(f"Last handover: {c['last'][0]} by {c['last'][2]}: {c['last'][1]}")
    if c["commits"]:
        authors = sorted({a for _, _, a, _ in c["commits"]})
        out.append(f"{len(c['commits'])} commit(s) by {', '.join(authors)}:")
        shown = c["commits"][:8] if brief else c["commits"]
        out += [f"- {h} {d} {a}: {s}" for h, d, a, s in shown]
        if len(shown) < len(c["commits"]):
            out.append(f"- ... and {len(c['commits']) - len(shown)} more (python tools/handover.py since)")
    else:
        out.append("No new commits.")
    out += gap_lines(c)
    if c["branches"]:
        out.append("Work in progress on other branches (pushed, not on main yet, last 30 days):")
        out += [f"- {b} by {a}: {n} commit(s), last {r}" for b, a, n, r in c["branches"][:6]]
    if not c["hooks_on"]:
        out.append("Tip: run `git config core.hooksPath .githooks` once, so a push to main without a handover warns you.")
    if c["groups"]:
        out.append("Areas: " + "; ".join(f"{k} ({len(v)})" for k, v in sorted(c["groups"].items())))
        out.append(deploy_line(c["groups"]))
        if not brief:
            for k, v in sorted(c["groups"].items()):
                out.append(f"\n### {k}")
                out += [f"- {f}" for f in v]
    if c["ahead_behind"]:
        ahead, behind = c["ahead_behind"].split()
        out.append(f"\nYour branch `{c['branch']}`: {ahead} commit(s) not on {c['up']}, {behind} behind it."
                   + (" Pull before editing." if behind != "0" else ""))
    if c["local"]:
        out.append(f"Uncommitted here: {len(c['local'])} file(s)" + ("" if brief else ":"))
        if not brief:
            out += [f"  {l}" for l in c["local"][:30]]
    if c["tag"]:
        out.append(f"Latest release: {c['tag']}; {c['unreleased'] or 0} commit(s) on {c['up']} since it.")
    out.append(c["notes"].splitlines()[0] if c["notes"] else "release-notes check: no output")
    out.append("Read the last entry of work/HANDOVER.md for where the previous session stopped.")
    print("\n".join(out))


def gap_lines(c):
    """Say plainly which work has no handover entry yet, and whose it is."""
    out = []
    if c["commits"]:
        counts = {}
        for _, _, a, _ in c["commits"]:
            counts[a] = counts.get(a, 0) + 1
        who = ", ".join(f"{a} ({n})" for a, n in sorted(counts.items()))
        out.append(f"\nHANDOVER GAP: no handover entry covers these {len(c['commits'])} commit(s) yet: {who}.")
        others = [a for a in counts if a != c["me"]]
        if others:
            out.append(f"  Ask {', '.join(others)} what is unfinished, or run /catch-up and let it backfill an entry from git.")
    mine = (c["me"] in {a for _, _, a, _ in c["commits"]}) or c["unpushed"] or c["local"]
    if mine and not c["entry_open"]:
        bits = []
        if c["unpushed"]:
            bits.append(f"{len(c['unpushed'])} unpushed commit(s)")
        if c["local"]:
            bits.append(f"{len(c['local'])} uncommitted file(s)")
        if c["me"] in {a for _, _, a, _ in c["commits"]}:
            bits.append("pushed commits")
        out.append(f"  You ({c['me'] or 'this machine'}): {', '.join(bits)} with no handover yet. "
                   "Run /handover before you stop.")
    elif c["entry_open"]:
        out.append("  A handover entry is in progress here (work/HANDOVER.md changed): commit it with your work.")
    return out


def gap(c, ci):
    """One line for CI and git hooks. Always exits 0: it warns, it never blocks."""
    if not c["commits"]:
        print("Handover: every commit on main is covered by an entry in work/HANDOVER.md.")
        return
    counts = {}
    for _, _, a, _ in c["commits"]:
        counts[a] = counts.get(a, 0) + 1
    who = ", ".join(f"{a} ({n})" for a, n in sorted(counts.items()))
    msg = (f"No handover entry covers {len(c['commits'])} commit(s) on main: {who}. "
           "Run /handover (or python tools/handover.py draft) and push the entry to work/HANDOVER.md.")
    print(f"::warning title=Handover missing::{msg}" if ci else f"HANDOVER GAP: {msg}")


def draft(c):
    now = datetime.now(SGT)
    who = git("config", "user.name") or "Unassigned"
    head = git("rev-parse", "--short", c["up"]) or "unknown"
    changed = "; ".join(f"{k}: {', '.join(v[:6])}{' ...' if len(v) > 6 else ''}"
                        for k, v in sorted(c["groups"].items())) or "no committed changes since the last entry"
    commits = ", ".join(f"`{h}` {s}" for h, _, _, s in c["commits"][:10]) or "none"
    local = f"{len(c['local'])} uncommitted file(s) on `{c['branch']}`" if c["local"] else "none"
    print(f"""## {now:%Y-%m-%d} — <what changed, in a few words>

- Author: {who} (with <Claude Code / by hand>). Time: {now:%H:%M} SGT.
- Up to: `{head}` on `{c['up']}`. Commits read since the last entry: {commits}.
- Objective: <what the person asked for>
- Changed: {changed}. Uncommitted: {local}.
- Deploy and release: {deploy_line(c['groups'])} {c['notes'].splitlines()[0] if c['notes'] else ''}
- Checks run: <command: actual result. Never PASS for a check nobody ran>
- Not checked: <what was skipped and why>
- Waiting on a person: <decision, review or access, or none>
- Next action: <one concrete step>
""")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=("since", "draft", "gap"))
    p.add_argument("--ci", action="store_true", help="gap: print as a GitHub Actions warning annotation")
    p.add_argument("--fetch", action="store_true", help="git fetch origin first (15 s limit)")
    p.add_argument("--brief", action="store_true", help="short summary (used at session start)")
    a = p.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    if not git("rev-parse", "--git-dir"):
        sys.exit("not a git repository")
    c = collect(a.fetch)
    if a.command == "gap":
        gap(c, a.ci)
    else:
        since(c, a.brief) if a.command == "since" else draft(c)


if __name__ == "__main__":
    main()
