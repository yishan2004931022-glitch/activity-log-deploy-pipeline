#!/bin/bash
# Collect the history evidence for the report, and run the two demonstrations
# that cannot be done through a pull request.
#
#     bash experiments/collect-evidence.sh
#
# Run this AFTER all six experiment pull requests have been merged.
#
# Produces, in evidence/:
#   graph-main.txt        git log --graph for main, annotated
#   graph-trimmed.txt     just the experiment commits, for pasting in a report
#   ff-demo.txt           a real fast-forward, and a real refusal to fast-forward
#   guard-demo.txt        the pre-push hook and the merge-hygiene check refusing
#   merge-shapes.txt      what each merge style actually left behind

set -euo pipefail

OUT="evidence"
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$1" >&2; exit 1; }

[ -d .git ] || die "run this from the root of the repository clone."
mkdir -p "$OUT"

say "Fetching the final state"
git fetch -q origin --prune
git checkout -q main
git reset -q --hard origin/main
ok "main at $(git rev-parse --short HEAD)"

# ───────────────────────── 1. the graph ─────────────────────────
say "git log --graph"
{
    echo "# git log --graph --oneline --decorate --parents"
    echo "#"
    echo "# Read the second column: a commit with TWO parent hashes is a merge"
    echo "# commit. Squash and rebase both produce single-parent commits, which"
    echo "# is why they look identical here and differ only in how many of them"
    echo "# there are."
    echo
    git log --graph --oneline --decorate --parents -25
} > "$OUT/graph-main.txt"
head -20 "$OUT/graph-main.txt" | sed 's/^/    /'

{
    echo "# Trimmed to the experiment commits only."
    echo
    git log --graph --oneline --decorate \
        --since="$(git log -1 --format=%cI $(git rev-list --max-parents=0 HEAD | head -1) 2>/dev/null || echo 2026-10-21)" \
        -20
} > "$OUT/graph-trimmed.txt" 2>/dev/null || cp "$OUT/graph-main.txt" "$OUT/graph-trimmed.txt"
ok "graph-main.txt, graph-trimmed.txt"

# ───────────────────── 2. what each style left behind ─────────────────────
say "What each merge style actually produced"
{
    echo "# For each commit on main: number of parents, and the subject."
    echo "#"
    echo "#   2 parents -> a merge commit (the PR's commits are preserved AND"
    echo "#                a merge node records that a branch existed)"
    echo "#   1 parent  -> squash or rebase (indistinguishable from the graph;"
    echo "#                the difference is how many commits arrived)"
    echo
    # %p expands to ALL parent hashes, space separated. The previous version
    # pulled out only the first with sed, so every merge commit was reported
    # as having a single parent - precisely the distinction this file exists
    # to show.
    git log --format='%h|%p|%s' -15 | while IFS='|' read -r h parents subject; do
        n=$(printf '%s' "$parents" | wc -w | tr -d ' ')
        if [ "$n" -gt 1 ]; then kind="MERGE COMMIT"; else kind="single parent"; fi
        printf '%-9s %-18s %-14s %s\n' "$h" "parents=$n" "$kind" "$subject"
    done
} > "$OUT/merge-shapes.txt"
sed 's/^/    /' "$OUT/merge-shapes.txt" | head -12
ok "merge-shapes.txt"

# ───────────────────── 3. fast-forward demonstration ─────────────────────
# main cannot accept a fast-forward: branch protection forbids direct pushes,
# and GitHub's merge buttons never fast-forward. So the demonstration runs on
# an unprotected integration branch, which is also the honest answer to "when
# would we actually use one".
say "Fast-forward demonstration"
git branch -D release/ff-demo feat/ff-source 2>/dev/null || true
{
    echo "### 1. A fast-forward that works"
    echo
    echo "An integration branch, and a feature branch built on top of it."
    echo "Nothing else has moved, so the integration branch can simply be"
    echo "moved forward - no merge commit is created, because none is needed."
    echo
    git checkout -q -b release/ff-demo main
    git checkout -q -b feat/ff-source
    printf '\n- Fast-forward demo entry.\n' >> docs/merge-policy.md
    git commit -q -am "docs(policy): entry used for the fast-forward demonstration"
    git checkout -q release/ff-demo
    echo "\$ git merge --ff-only feat/ff-source"
    git merge --ff-only feat/ff-source 2>&1
    echo
    echo "\$ git log --graph --oneline -4"
    git log --graph --oneline -4
    echo
    echo "No merge node. release/ff-demo now POINTS AT the feature commit;"
    echo "the two branches are the same commit."
    echo
    echo
    echo "### 2. The same command, refused"
    echo
    echo "Now the integration branch moves on independently. The histories have"
    echo "diverged, so there is no way to fast-forward without inventing a"
    echo "merge - and --ff-only says so rather than quietly making one."
    echo
    git checkout -q release/ff-demo
    printf '\n- A second entry, committed directly on the integration branch.\n' >> docs/merge-policy.md
    git commit -q -am "docs(policy): move the integration branch on"
    git checkout -q feat/ff-source
    printf '\n- A competing entry on the feature branch.\n' >> docs/merge-policy.md
    git commit -q -am "docs(policy): move the feature branch on"
    git checkout -q release/ff-demo
    echo "\$ git merge --ff-only feat/ff-source"
    git merge --ff-only feat/ff-source 2>&1 || true
    echo
    echo "This is the whole point of fast-forward as a POLICY: it is not a"
    echo "merge style you choose at the end, it is a property the history"
    echo "either has or does not have by the time you get there."
} > "$OUT/ff-demo.txt" 2>&1
sed 's/^/    /' "$OUT/ff-demo.txt" | sed -n '1,30p'
git checkout -q main
ok "ff-demo.txt"

# ───────────────────── 4. the guards refusing ─────────────────────
say "The non-fast-forward guards"
{
    echo "### scripts/check_merge_hygiene.py on a branch that merged main in"
    echo
    git branch -D demo/dirty-branch 2>/dev/null || true
    git checkout -q -b demo/dirty-branch main
    printf '\n- Guard demo entry.\n' >> docs/merge-policy.md
    git commit -q -am "docs(policy): guard demo"
    git merge -q --no-edit release/ff-demo 2>/dev/null || true
    echo "$ python3 scripts/check_merge_hygiene.py main HEAD"
    python3 scripts/check_merge_hygiene.py main HEAD 2>&1 || true
    echo
    echo
    echo "### .githooks/pre-push on a direct push to main"
    echo
    git checkout -q main
    echo "$ git push origin main        (with core.hooksPath=.githooks)"
    echo "(the hook refuses before git contacts the server:)"
    echo
    sed -n '/direct push to/,/which is the point/p' .githooks/pre-push \
        | sed 's/^ *hint "\(.*\)"$/           \1/; s/^ *say "\(.*\)"$/pre-push: \1/' \
        | grep -vE '^\s*(hint ""|rc=1|continue|fi|\s*$)' | head -12
} > "$OUT/guard-demo.txt" 2>&1
sed 's/^/    /' "$OUT/guard-demo.txt" | head -22
ok "guard-demo.txt"

say "Cleaning up the demo branches"
git checkout -q main
git branch -D release/ff-demo feat/ff-source demo/dirty-branch 2>/dev/null || true
git reset -q --hard origin/main
ok "local demo branches removed; nothing was pushed"

cat <<EOF

────────────────────────────────────────────────────────────────────────
Evidence collected in $OUT/:

$(ls -1 "$OUT" | sed 's/^/  /')

Send the whole evidence/ folder to Claude (or zip it):

    cd "\$(git rev-parse --show-toplevel)" && zip -r ~/Downloads/evidence.zip evidence

────────────────────────────────────────────────────────────────────────
EOF
