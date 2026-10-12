#!/usr/bin/env bash
#
# One-shot setup. Run this once from inside this folder:
#
#     bash SETUP.sh
#
# It pushes the repository (keeping its four-commit history), then creates the
# four environments with their variables, secrets and the production
# protection rule. You will be asked for your GitHub token once; it is read
# into a shell variable and never written to disk by this script.
#
set -euo pipefail

REPO="yishan2004931022-glitch/activity-log-deploy-pipeline"
REMOTE="https://github.com/${REPO}.git"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }

# ── 1. sanity checks ─────────────────────────────────────────────────────────
command -v git >/dev/null || { echo "git is not installed"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is not installed"; exit 1; }
[ -d .git ] || { echo "Run this from inside the unzipped folder."; exit 1; }

say "Repository: ${REPO}"
git log --oneline | sed 's/^/    /'

# ── 2. token ─────────────────────────────────────────────────────────────────
say "Paste your GitHub token (it will not be echoed)"
read -rsp "    token: " GH_TOKEN
echo
[ -n "${GH_TOKEN}" ] || { echo "No token given."; exit 1; }
export GH_TOKEN

who=$(curl -fsS -H "Authorization: Bearer ${GH_TOKEN}" \
        https://api.github.com/user \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["login"])')
echo "    authenticated as ${who}"

# ── 3. push ──────────────────────────────────────────────────────────────────
say "Pushing to GitHub"
git remote remove origin 2>/dev/null || true
# The token is placed in the URL only for this one command and the remote is
# removed again immediately, so it is not left behind in .git/config.
git remote add origin "https://${GH_TOKEN}@github.com/${REPO}.git"
git push -u origin main
git remote set-url origin "${REMOTE}"
echo "    pushed; remote reset to the plain https URL"

# ── 4. environments ──────────────────────────────────────────────────────────
say "Creating environments, variables, secrets and the protection rule"
REPO="${REPO}" python3 scripts/setup_environments.py

# ── 5. what is left for you ──────────────────────────────────────────────────
cat <<EOF

$(printf '\033[1;32m==>\033[0m') Done. Two things are left, both in the browser:

  1. Dev release (Grade A evidence)
     The push above already triggered it. Check:
     https://github.com/${REPO}/actions/workflows/ci-dev.yml

  2. Full pipeline (Grade E + O evidence)
     https://github.com/${REPO}/actions/workflows/cicd-pipeline.yml
     -> "Run workflow", leave "Stop after staging" unticked, Run.
     It will pause at "Deploy to production" and wait for you.
     Open the run, click "Review deployments", tick production, Approve.

Then come back to the chat and say it is done.
EOF
