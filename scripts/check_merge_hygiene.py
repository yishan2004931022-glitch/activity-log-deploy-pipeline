#!/usr/bin/env python3
"""Refuse a pull request whose branch carries merge commits.

Why this exists
---------------
Branch protection stops anyone pushing straight to `main`, so every change
arrives through a pull request. What it does not stop is a contributor running
`git merge main` inside their own branch and pushing the result. The pull
request still merges cleanly, so nothing complains - but the branch now
contains a merge commit nobody reviewed, and three of the four merge styles
will carry it onto `main`.

That matters for the two things a history is for:

  * bisectability - `git bisect` has to pick a side at every merge, and a
    merge that exists only to catch up with `main` is noise in that search.
  * revert risk   - reverting a merge commit needs `-m`, and getting the
    parent number wrong reverts the opposite side of the history.

So the policy is: catch up with `main` by rebasing, not by merging. This check
enforces it at the only moment it can be fixed cheaply - before the merge
button is available.

It is deliberately a *check*, not a block on the contributor's machine: the
`.githooks/pre-push` hook gives the same answer earlier, but a hook is opt-in
and can be skipped with `--no-verify`. This runs on the server, where it
cannot be.

Usage (in CI):   python3 scripts/check_merge_hygiene.py <base-sha> <head-sha>
"""

from __future__ import annotations

import os
import subprocess
import sys


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    return result.stdout.strip()


def summary(text: str) -> None:
    """Append to the workflow run summary, when running inside Actions."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: check_merge_hygiene.py <base-sha> <head-sha>", file=sys.stderr)
        return 2

    base, head = argv[1], argv[2]
    rng = f"{base}..{head}"

    # %p is the parent list; a commit with two or more parents is a merge.
    raw = git("log", rng, "--pretty=format:%H%x1f%p%x1f%s")
    if not raw:
        print(f"no commits in {rng}; nothing to check")
        summary("### Merge hygiene\n\nNo commits in range - nothing to check.")
        return 0

    commits, merges = [], []
    for line in raw.splitlines():
        sha, parents, subject = line.split("\x1f", 2)
        entry = (sha[:7], len(parents.split()), subject)
        commits.append(entry)
        if entry[1] > 1:
            merges.append(entry)

    print(f"commits in {rng}: {len(commits)}")
    for sha, nparents, subject in commits:
        marker = "  MERGE ->" if nparents > 1 else "          "
        print(f"{marker} {sha} ({nparents} parent{'s' if nparents > 1 else ''}) {subject}")

    if not merges:
        print("\nOK: the branch is a linear series of commits.")
        summary(
            "### Merge hygiene\n\n"
            f"**Clean.** {len(commits)} commit(s), all with a single parent, so this "
            "branch can be merged in any of the four styles without dragging an "
            "unreviewed merge onto `main`."
        )
        return 0

    print(f"\nFAILED: {len(merges)} merge commit(s) in this branch.")
    lines = [
        "### Merge hygiene",
        "",
        f"**Blocked.** This branch contains {len(merges)} merge commit(s):",
        "",
    ]
    for sha, nparents, subject in merges:
        print(f"  {sha} {subject}")
        lines.append(f"- `{sha}` ({nparents} parents) {subject}")
    lines += [
        "",
        "Catch up with `main` by rebasing instead:",
        "",
        "```bash",
        "git fetch origin main",
        "git rebase origin/main",
        "git push --force-with-lease",
        "```",
        "",
        "`--force-with-lease` rather than `--force`: it refuses the push if "
        "someone else has moved the branch since you last fetched it.",
    ]
    summary("\n".join(lines))

    print("::error::merge commits in a pull request branch; rebase onto main instead")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
