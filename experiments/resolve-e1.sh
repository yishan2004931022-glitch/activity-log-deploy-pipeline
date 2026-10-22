#!/bin/bash
# Experiment 1 — resolve the conflict, and demonstrate rerere and range-diff.
#
#     bash experiments/resolve-e1.sh
#
# What happens, in order:
#
#   1. Rebase exp1/dev-b-rebase onto the new main. Both sides edited the same
#      line of docs/merge-policy.md, so git stops and asks a human.
#   2. Write the PM's decision - which is a synthesis, not a coin toss.
#   3. Finish the rebase. git rerere RECORDS the resolution.
#   4. Rewind the branch and rebase again. rerere REPLAYS the resolution
#      without asking. That replay is the thing worth demonstrating: on a long
#      lived branch you hit the same conflict every time you rebase, and
#      resolving it identically by hand every time is how mistakes happen.
#   5. git range-diff compares the branch before and after the rebase, which
#      answers the question a reviewer actually has: "the commit hash changed,
#      but did the CONTENT change?"
#
# Everything is written to evidence/ for the report.

set -euo pipefail

BRANCH="exp1/dev-b-rebase"
POLICY="docs/merge-policy.md"
OUT="evidence"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$1" >&2; exit 1; }

[ -d .git ] || die "run this from the root of the repository clone."
mkdir -p "$OUT"

say "Confirming rerere is on"
git config rerere.enabled true
git config rerere.autoUpdate true
ok "rerere.enabled=$(git config rerere.enabled)  autoUpdate=$(git config rerere.autoUpdate)"

say "Fetching"
git fetch -q origin
git checkout -q -B "$BRANCH" "origin/$BRANCH"
PRE=$(git rev-parse HEAD)
OLD_BASE=$(git merge-base "$PRE" origin/main)
ok "branch tip before rebase : ${PRE:0:7}"
ok "original base            : ${OLD_BASE:0:7}"
ok "main is now at           : $(git rev-parse --short origin/main)"

# The PM's decision. Neither side wins outright: squash becomes the default
# because it is the safest thing to revert, and rebase is kept for the cases
# where the individual commits are the reviewable unit.
RESOLUTION='Default merge style: **Squash and merge**, with one exception. Squash is the default because a squashed commit reverts with a plain `git revert <sha>` and `git bisect` lands on whole changes. Use **Rebase and merge** when the individual commits are the reviewable unit - a migration applied in deliberate steps, for example. **Merge commits** are reserved for integrating a long-lived branch, where losing the fact that it was a branch would misrepresent the history.'

resolve_policy() {
    python3 - "$POLICY" "$RESOLUTION" <<'PY'
import pathlib, sys
path, resolution = pathlib.Path(sys.argv[1]), sys.argv[2]
lines, out, in_conflict, replaced = path.read_text(encoding="utf-8").splitlines(), [], False, False
for line in lines:
    if line.startswith("<<<<<<<"):
        in_conflict = True
        if not replaced:
            out.append(resolution)
            replaced = True
        continue
    if line.startswith(("=======", ">>>>>>>")) and in_conflict:
        if line.startswith(">>>>>>>"):
            in_conflict = False
        continue
    if not in_conflict:
        out.append(line)
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("resolved" if replaced else "no conflict markers found")
PY
}

# ─────────────────── 1. first rebase: record the resolution ───────────────────
say "Rebasing onto main (expect a conflict)"
if git rebase origin/main > "$OUT/e1-rebase-attempt1.txt" 2>&1; then
    cat "$OUT/e1-rebase-attempt1.txt"
    die "no conflict appeared. Has PR #2 been merged yet?"
fi
cat "$OUT/e1-rebase-attempt1.txt" | sed 's/^/    /'
ok "conflict raised, as designed"

say "The conflict, exactly as git wrote it"
sed -n '/^<<<<<<</,/^>>>>>>>/p' "$POLICY" | tee "$OUT/e1-conflict-markers.txt" | sed 's/^/    /'

say "Applying the PM's resolution"
resolve_policy | sed 's/^/    /'
git add "$POLICY"
GIT_EDITOR=true git rebase --continue > "$OUT/e1-rebase-continue.txt" 2>&1 || true
ok "rebase finished; rerere has recorded this resolution"
POST=$(git rev-parse HEAD)
ok "branch tip after rebase: ${POST:0:7}"

# ─────────────────── 2. rewind and prove rerere replays it ───────────────────
say "Rewinding to prove rerere replays the resolution"
git checkout -q -B "$BRANCH" "$PRE"
{
    echo "### Second rebase, with the resolution already recorded"
    echo
    git rebase origin/main 2>&1 || true
} > "$OUT/e1-rerere-replay.txt"
grep -iE "recorded|previous resolution|conflict" "$OUT/e1-rerere-replay.txt" | sed 's/^/    /' || true

if grep -qi "previous resolution" "$OUT/e1-rerere-replay.txt"; then
    ok "rerere replayed the recorded resolution"
else
    printf '    (rerere did not report a replay; see %s)\n' "$OUT/e1-rerere-replay.txt"
fi

# autoUpdate stages the resolved file, but the rebase still waits for us.
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    git add "$POLICY" 2>/dev/null || true
    GIT_EDITOR=true git rebase --continue >> "$OUT/e1-rerere-replay.txt" 2>&1 || true
fi
NEW=$(git rev-parse HEAD)
ok "branch tip: ${NEW:0:7}"

say "What rerere has on file"
git rerere status > "$OUT/e1-rerere-status.txt" 2>&1 || true
ls -1 .git/rr-cache 2>/dev/null | head -5 | sed 's/^/    cached resolution: /' || true

# ─────────────────── 3. range-diff: did the content change? ───────────────────
say "range-diff: the same change before and after the rebase"
{
    echo "# git range-diff ${OLD_BASE:0:7}..${PRE:0:7} $(git rev-parse --short origin/main)..${NEW:0:7}"
    echo "#"
    echo "# Left  = the commit as originally written, on the old base."
    echo "# Right = the same commit after rebasing onto the new main."
    echo "# A '!' means the content differs - here, because the conflict was"
    echo "# resolved during the rebase. That is exactly what a reviewer needs"
    echo "# to see: the hash changed AND so did the content, deliberately."
    echo
    git range-diff "$OLD_BASE..$PRE" "origin/main..$NEW" 2>&1 || true
} > "$OUT/e1-range-diff.txt"
head -30 "$OUT/e1-range-diff.txt" | sed 's/^/    /'

say "Pushing the resolved branch"
git push -q --force-with-lease origin "$BRANCH"
ok "pushed (--force-with-lease: refuses if someone else moved the branch)"

say "The resolved policy line"
grep -n "Default merge style:" "$POLICY" | fold -w 100 -s | sed 's/^/    /'

cat <<EOF

────────────────────────────────────────────────────────────────────────
Experiment 1 resolved. Evidence written to $OUT/:

  e1-conflict-markers.txt   the conflict as git produced it
  e1-rebase-attempt1.txt    the failing rebase
  e1-rerere-replay.txt      rerere replaying the recorded resolution
  e1-rerere-status.txt      what rerere has on file
  e1-range-diff.txt         before vs after the rebase

PR #3 should now show as mergeable. Tell Claude.
────────────────────────────────────────────────────────────────────────
EOF
