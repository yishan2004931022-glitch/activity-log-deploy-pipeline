#!/bin/bash
# Set up the branches for the three merge-style experiments.
#
#   bash experiments/run.sh devA     # collaborator A's three branches
#   bash experiments/run.sh devB     # collaborator B's three branches
#   bash experiments/run.sh blocked  # a branch that deliberately fails CI
#
# Each role pushes branches only; nothing is merged here. Merging is done
# through pull requests on github.com, because the whole point of the exercise
# is what the different merge buttons do to the history.
#
# The conflicts are designed, not stumbled into:
#
#   Experiment 1  both roles edit THE SAME LINE of docs/merge-policy.md
#                 -> git cannot pick a side; a human has to.
#   Experiment 2  both roles edit THE SAME FILE in DIFFERENT PLACES
#                 -> git merges it cleanly; "same file" is not the thing that
#                    causes a conflict, "same lines" is.
#   Experiment 3  the roles touch DIFFERENT FILES entirely
#                 -> no conflict is even possible.
#
# Safe to re-run: each branch is recreated from the current origin/main.

set -euo pipefail

ROLE="${1:-}"
POLICY="docs/merge-policy.md"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$1" >&2; exit 1; }

case "$ROLE" in
    devA|devB|blocked) ;;
    *) die "usage: bash experiments/run.sh {devA|devB|blocked}" ;;
esac

[ -d .git ] || die "run this from the root of the repository clone."
[ -f "$POLICY" ] || die "$POLICY is missing. Pull the latest main first."

say "Checking the starting point"
git fetch -q origin main
BASE=$(git rev-parse origin/main)
ok "origin/main is at ${BASE:0:7}"
WHO=$(git config user.name || echo "unknown")
ok "committing as: $WHO <$(git config user.email || echo unknown)>"

# Recreate a branch from origin/main, discarding any previous attempt.
fresh() {
    git checkout -q -B "$1" "$BASE"
}

push() {
    git push -q --force-with-lease -u origin "$1"
    ok "pushed $1"
}

# Replace the single policy line that experiment 1 fights over.
set_default_style() {
    local replacement="$1"
    python3 - "$POLICY" "$replacement" <<'PY'
import sys, pathlib
path, replacement = pathlib.Path(sys.argv[1]), sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()
for i, line in enumerate(lines):
    if line.startswith("Default merge style:"):
        lines[i] = replacement
        break
else:
    raise SystemExit("could not find the 'Default merge style:' line")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

# ─────────────────────────────── devA ───────────────────────────────
if [ "$ROLE" = "devA" ]; then

    say "E1 — same file, same line"
    fresh exp1/dev-a-squash
    set_default_style "Default merge style: **Squash and merge**. One commit per pull request keeps \`main\` readable and makes \`git bisect\` land on whole changes rather than half-finished ones."
    git commit -q -am "docs(policy): adopt squash and merge as the default

One commit per pull request. The history of main then reads as a list of
changes rather than a list of keystrokes, and every commit on main is a
state that CI has actually seen green."
    push exp1/dev-a-squash

    say "E2 — same file, different lines"
    fresh exp2/dev-a-status-row
    python3 - "$POLICY" <<'PY'
import sys, pathlib
path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
text = text.replace(
    "| Applies to | `main` |",
    "| Applies to | `main` |\n| Required check | `gate` |",
)
path.write_text(text, encoding="utf-8")
PY
    git commit -q -am "docs(policy): record the required status check in the table

Branch protection requires one check by name. Writing that name down here
means nobody has to go and read the protection rule to find out what it is."
    push exp2/dev-a-status-row

    say "E3 — a different file entirely"
    fresh exp3/dev-a-ci-gates
    mkdir -p docs
    cat > docs/ci-gates.md <<'EOF'
# CI gates

What has to pass before a change can land, and what each gate is for.

| Gate | Where it runs | What it catches |
| --- | --- | --- |
| Merge hygiene | pull request | a branch that merged `main` into itself instead of rebasing |
| ESLint | pull request | unused variables, undeclared globals, unreachable code |
| Ruff | pull request | the same class of mistake in the Python helpers |
| JavaScript tests | pull request | logic regressions, and bundling faults via the built artifact |
| Python 3.11 / 3.12 / 3.13 | pull request | a helper that depends on one interpreter's behaviour |
| `gate` | pull request | the single check branch protection requires |

`gate` exists so that branch protection names one check instead of six. A
matrix produces one check per leg, so requiring the legs individually would
mean editing the protection rule every time the matrix changes.
EOF
    git add docs/ci-gates.md
    git commit -q -m "docs: describe what each CI gate is for

A new contributor can see which check blocked them and why without
reading three workflow files."
    push exp3/dev-a-ci-gates

# ─────────────────────────────── devB ───────────────────────────────
elif [ "$ROLE" = "devB" ]; then

    say "E1 — same file, same line (this will conflict with devA)"
    fresh exp1/dev-b-rebase
    set_default_style "Default merge style: **Rebase and merge**. Keeping every individual commit preserves the author's reasoning, and a linear history means \`git bisect\` never has to choose a side at a merge."
    git commit -q -am "docs(policy): adopt rebase and merge as the default

Squashing throws away the steps the author took, which is the part that is
useful six months later when you are trying to work out why. Rebasing keeps
them and still leaves main linear."
    push exp1/dev-b-rebase

    say "E2 — same file, different lines (this should merge cleanly)"
    fresh exp2/dev-b-rationale
    python3 - "$POLICY" <<'PY'
import sys, pathlib
path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
text = text.replace(
    "## Open questions",
    "## Revert procedure\n"
    "\n"
    "A squashed or rebased commit reverts with `git revert <sha>`. A merge\n"
    "commit needs `git revert -m 1 <sha>`, where `1` means \"keep the first\n"
    "parent\", and getting that number wrong reverts the opposite side of the\n"
    "history. That asymmetry is the main practical argument against merge\n"
    "commits for routine changes.\n"
    "\n"
    "## Open questions",
)
path.write_text(text, encoding="utf-8")
PY
    git commit -q -am "docs(policy): write down how a revert actually works

The -m flag on reverting a merge is the detail everyone gets wrong under
pressure, which is exactly when they need it."
    push exp2/dev-b-rationale

    say "E3 — a different file entirely"
    fresh exp3/dev-b-readme
    python3 - <<'PY'
import pathlib
path = pathlib.Path("README.md")
text = path.read_text(encoding="utf-8")
marker = "A multi-stage GitHub Actions deployment pipeline"
addition = (
    "[![PR Checks](https://github.com/yishan2004931022-glitch/"
    "activity-log-deploy-pipeline/actions/workflows/ci-pr.yml/badge.svg)]"
    "(https://github.com/yishan2004931022-glitch/"
    "activity-log-deploy-pipeline/actions/workflows/ci-pr.yml)\n\n"
)
text = text.replace(marker, addition + marker, 1)
path.write_text(text, encoding="utf-8")
PY
    git commit -q -am "docs: add the PR Checks badge to the README

The badge that says whether pull requests are currently passing was the one
missing from the row."
    push exp3/dev-b-readme

# ───────────────────────────── blocked ─────────────────────────────
else
    say "A branch that deliberately fails CI"
    fresh exp0/blocked-by-ci
    python3 - <<'PY'
import pathlib
path = pathlib.Path("scripts/compute_version.py")
text = path.read_text(encoding="utf-8")
# Off by one: the next release would reuse the number already published.
old = "    return highest + 1"
assert old in text, "compute_version.py has changed; update this experiment"
text = text.replace(old, "    return highest  # BUG: reuses the published number")
path.write_text(text, encoding="utf-8")
PY
    git commit -q -am "feat(version): simplify the patch calculation

Deliberately broken, to show branch protection refusing a merge. The Python
suite asserts that the next patch is one ABOVE the highest existing tag, so
this fails on all three interpreters."
    push exp0/blocked-by-ci
fi

git checkout -q main 2>/dev/null || true

cat <<EOF

────────────────────────────────────────────────────────────────────────
Branches pushed. Nothing has been merged.

Open the pull requests on github.com. The order matters for experiment 1:
devA's PR must merge FIRST so that devB's PR is the one that has to resolve
the conflict.
────────────────────────────────────────────────────────────────────────
EOF
