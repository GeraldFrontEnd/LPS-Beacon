"""Check release-notes.json and turn its new entries into a version bump and release notes.

"New" entries are the ones not yet in the file at the last release tag (the base). Standard library only.

  python tools/release_notes.py check [--base v1.2.0]          # validate (run before you push)
  python tools/release_notes.py bump  --base v1.2.0            # prints major, minor, fix or none
  python tools/release_notes.py notes --base v1.2.0            # prints the What's new markdown

Without --base, `check` compares with the newest v* tag (or validates the file alone if there is none).
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

FILE = "release-notes.json"
ROOT = Path(__file__).resolve().parent.parent
TYPES = ("fix", "minor", "major")  # in increasing size
AUDIENCES = ("platform",)
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def fail(msg):
    print(f"{FILE}: {msg}", file=sys.stderr)
    sys.exit(1)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def latest_tag():
    out = git("tag", "--list", "v*", "--sort=-v:refname").stdout.split()
    return out[0] if out else ""


def load_current():
    try:
        return json.loads((ROOT / FILE).read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail("not found at the repository root")
    except json.JSONDecodeError as e:
        fail(f"not valid JSON: {e}")


def load_base(ref):
    """The file as it was at `ref`; empty if there is no ref or the file did not exist then."""
    if not ref:
        return {"entries": []}
    if git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").returncode != 0:
        fail(f"base '{ref}' is not a known tag or commit (fetch tags: git fetch --tags)")
    shown = git("show", f"{ref}:{FILE}")
    if shown.returncode != 0:
        return {"entries": []}
    try:
        return json.loads(shown.stdout)
    except json.JSONDecodeError:
        return {"entries": []}


def validate(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("entries"), list):
        fail('needs an object with an "entries" list')
    if not isinstance(doc.get("about"), str) or not doc["about"].strip():
        fail('needs an "about" text')
    seen = set()
    for i, e in enumerate(doc["entries"]):
        where = f"entry {i + 1}"
        if not isinstance(e, dict):
            fail(f"{where} is not an object")
        extra = set(e) - {"id", "type", "text", "audience"}
        if extra:
            fail(f"{where} has unknown field(s): {', '.join(sorted(extra))}")
        eid = e.get("id")
        if not isinstance(eid, str) or not ID_RE.match(eid):
            fail(f"{where}: id must be lowercase words joined by hyphens, e.g. dashboard-period-filter")
        where = f"entry '{eid}'"
        if eid in seen:
            fail(f"{where} appears twice; ids must be unique")
        seen.add(eid)
        if e.get("type") not in TYPES:
            fail(f"{where}: type must be one of {', '.join(TYPES)}")
        if not isinstance(e.get("text"), str) or not e["text"].strip():
            fail(f"{where}: text is empty")
        if "audience" in e and e["audience"] not in AUDIENCES:
            fail(f"{where}: audience may only be {', '.join(AUDIENCES)} (leave it out for everyone)")


def new_entries(doc, base):
    """Released entries must stay unchanged and first; everything after them is new."""
    released = base.get("entries", [])
    current = doc["entries"]
    for i, old in enumerate(released):
        if i >= len(current) or current[i] != old:
            fail(
                f"released entry '{old.get('id')}' was edited, moved or removed. "
                "Released entries never change: add a new entry at the end instead."
            )
    return current[len(released):]


def bump_level(entries):
    if not entries:
        return "none"
    return max((e["type"] for e in entries), key=TYPES.index)


def render_notes(entries):
    users = [e for e in entries if "audience" not in e]
    platform = [e for e in entries if e.get("audience") == "platform"]
    out = []
    if users:
        out.append("## What's new")
        features = [e for e in users if e["type"] != "fix"]
        fixes = [e for e in users if e["type"] == "fix"]
        if features:
            out += ["", "### New and changed"] + [
                f"- {'**Major:** ' if e['type'] == 'major' else ''}{e['text']}" for e in features
            ]
        if fixes:
            out += ["", "### Fixes"] + [f"- {e['text']}" for e in fixes]
        out.append("")
    if platform:
        out += ["## Platform team", ""] + [f"- {e['text']}" for e in platform] + [""]
    return "\n".join(out) + ("\n" if out else "")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=("check", "bump", "notes"))
    p.add_argument("--base", help="last release tag or commit to compare with")
    a = p.parse_args()

    base_ref = a.base if a.base is not None else (latest_tag() if a.command == "check" else "")
    doc = load_current()
    validate(doc)
    new = new_entries(doc, load_base(base_ref))

    if a.command == "check":
        since = f"since {base_ref}" if base_ref else "(no release tag to compare with)"
        print(f"{FILE}: OK. {len(new)} new entr{'y' if len(new) == 1 else 'ies'} {since}; next bump: {bump_level(new)}")
        for e in new:
            print(f"  + [{e['type']}{', ' + e['audience'] if 'audience' in e else ''}] {e['id']}")
    elif a.command == "bump":
        print(bump_level(new))
    else:
        sys.stdout.write(render_notes(new))


if __name__ == "__main__":
    main()
