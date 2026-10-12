#!/usr/bin/env python3
"""
Create GitHub labels, milestones, and issues from docs/REQUIREMENTS.md.

Every user story (#### US-xxx) and non-functional requirement (| NFR-x |)
becomes one issue, labeled by epic, priority, and type, and assigned to the
milestone listed in the Release Plan table.

Safe to re-run: existing labels are updated, and existing milestones and
issues (matched by title) are skipped.

Requirements:
  - GitHub CLI installed and signed in:  gh auth login
  - Run from inside your cloned repo, or pass --repo owner/name

Usage:
  python3 scripts/create_github_issues.py --dry-run     # preview only
  python3 scripts/create_github_issues.py               # create everything
  python3 scripts/create_github_issues.py --repo BradleyE99/debtnav
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_DOC = Path(__file__).resolve().parent.parent / "docs" / "REQUIREMENTS.md"

PRIORITY_COLORS = {"must": "B60205", "should": "FBCA04", "could": "0E8A16"}
TYPE_COLORS = {"story": "1D76DB", "nfr": "5319E7"}
EPIC_COLOR = "C5DEF5"

STORY_RE = re.compile(r"^#### (US-\d+): (.+?) \((Must|Should|Could)(?:, technical)?\)\s*$")
EPIC_RE = re.compile(r"^### Epic \d+: (.+?) \(`(epic:[\w-]+)`\)\s*$")
NFR_RE = re.compile(r"^\| (NFR-\d+) \| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|\s*$")
MILESTONE_RE = re.compile(r"^\| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|\s*$")


# ---------- Parsing ----------

def expand_ids(cell: str) -> list[str]:
    """Turn 'US-403, 404, 101–103, NFR-6' into individual IDs."""
    ids, prefix = [], "US"
    for token in (t.strip() for t in cell.split(",")):
        m = re.match(r"^(?:(US|NFR)-)?(\d+)(?:[–-](\d+))?$", token)
        if not m:
            continue
        prefix = m.group(1) or prefix
        start = int(m.group(2))
        end = int(m.group(3)) if m.group(3) else start
        ids.extend(f"{prefix}-{n}" for n in range(start, end + 1))
    return ids


def parse(doc: str):
    lines = doc.splitlines()
    stories, nfrs, milestones, epics = [], [], [], {}
    epic = None
    i = 0
    while i < len(lines):
        line = lines[i]

        if m := EPIC_RE.match(line):
            epic = m.group(2)
            epics[epic] = m.group(1)

        elif m := STORY_RE.match(line):
            body = []
            i += 1
            while i < len(lines) and not re.match(r"^#{1,4} |^---\s*$", lines[i]):
                body.append(lines[i])
                i += 1
            stories.append({
                "id": m.group(1),
                "title": f"{m.group(1)}: {m.group(2)}",
                "priority": m.group(3).lower(),
                "epic": epic,
                "body": "\n".join(body).strip(),
            })
            continue

        elif m := NFR_RE.match(line):
            nfrs.append({
                "id": m.group(1),
                "title": f"{m.group(1)}: {m.group(2)}",
                "priority": "must",
                "body": f"**Requirement:** {m.group(3)}\n\n**Verified by:** {m.group(4)}",
            })

        elif (m := MILESTONE_RE.match(line)) and re.match(r"^(M\d|Later)", m.group(1)):
            milestones.append({
                "title": m.group(1),
                "description": m.group(2),
                "ids": expand_ids(m.group(3)),
            })

        i += 1
    return stories, nfrs, milestones, epics


# ---------- GitHub calls ----------

def gh(args, repo, dry_run, capture=False):
    cmd = ["gh", *args] + (["--repo", repo] if repo and args[0] != "api" else [])
    if dry_run and not capture:
        print("  [dry-run] gh " + " ".join(a if " " not in a else repr(a) for a in args[:4]) + " ...")
        return ""
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed:\n{result.stderr.strip()}")
    return result.stdout


def repo_path(repo):
    if repo:
        return repo
    out = subprocess.run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("Couldn't detect the repo. Run inside your cloned repo or pass --repo owner/name.")
    return out.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc", type=Path, default=DEFAULT_DOC, help="Path to REQUIREMENTS.md")
    ap.add_argument("--repo", help="owner/name (defaults to the current repo)")
    ap.add_argument("--dry-run", action="store_true", help="Print what would be created")
    args = ap.parse_args()

    stories, nfrs, milestones, epics = parse(args.doc.read_text(encoding="utf-8"))
    milestone_of = {id_: ms["title"] for ms in milestones for id_ in ms["ids"]}
    print(f"Parsed {len(stories)} user stories, {len(nfrs)} NFRs, "
          f"{len(epics)} epics, {len(milestones)} milestones.")

    unassigned = [s["id"] for s in stories if s["id"] not in milestone_of]
    if unassigned:
        print(f"Note: no milestone listed for {', '.join(unassigned)}")

    repo = None if args.dry_run and not args.repo else repo_path(args.repo)

    # Labels
    print("\nLabels")
    labels = [(f"priority:{p}", c, f"MoSCoW: {p}") for p, c in PRIORITY_COLORS.items()]
    labels += [(f"type:{t}", c, "User story" if t == "story" else "Non-functional requirement")
               for t, c in TYPE_COLORS.items()]
    labels += [(e, EPIC_COLOR, name) for e, name in epics.items()]
    for name, color, desc in labels:
        gh(["label", "create", name, "--color", color, "--description", desc, "--force"],
           repo, args.dry_run)
        print(f"  {name}")

    # Milestones
    print("\nMilestones")
    existing_ms = set()
    if not args.dry_run:
        existing_ms = {m["title"] for m in json.loads(
            gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], repo, False, capture=True) or "[]")}
    for ms in milestones:
        if ms["title"] in existing_ms:
            print(f"  skip (exists) {ms['title']}")
            continue
        gh(["api", f"repos/{repo}/milestones", "-f", f"title={ms['title']}",
            "-f", f"description={ms['description']}"], repo, args.dry_run)
        print(f"  {ms['title']}")

    # Issues
    print("\nIssues")
    existing_titles = set()
    if not args.dry_run:
        existing_titles = {i["title"] for i in json.loads(
            gh(["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"],
               repo, False, capture=True) or "[]")}

    created = skipped = 0
    for item, kind in [(s, "story") for s in stories] + [(n, "nfr") for n in nfrs]:
        if item["title"] in existing_titles:
            skipped += 1
            continue
        item_labels = [f"priority:{item['priority']}", f"type:{kind}"]
        if kind == "story" and item["epic"]:
            item_labels.append(item["epic"])
        body = item["body"] + f"\n\n---\nSource: `docs/REQUIREMENTS.md` ({item['id']})"
        cmd = ["issue", "create", "--title", item["title"], "--body", body,
               "--label", ",".join(item_labels)]
        if item["id"] in milestone_of:
            cmd += ["--milestone", milestone_of[item["id"]]]
        gh(cmd, repo, args.dry_run)
        print(f"  {item['title']}  [{', '.join(item_labels)}]"
              + (f"  → {milestone_of[item['id']]}" if item["id"] in milestone_of else ""))
        created += 1

    verb = "Would create" if args.dry_run else "Created"
    print(f"\n{verb} {created} issues; skipped {skipped} that already exist.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(str(e))
