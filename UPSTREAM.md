# Upstream provenance

This repository is an adaptation of **[TheDanniCraft/activity-log](https://github.com/TheDanniCraft/activity-log)**,
used as the base software for NTUST DevOps Assignment 4 (deployment pipeline).

| | |
| --- | --- |
| Upstream | `TheDanniCraft/activity-log` |
| Commit taken | `681a71ce37dda47402d8af858fcd35b89ae281ea` (2026-10-12) |
| Upstream licence | MIT — see `LICENSE`, copyright © 2024 TheDanniCraft |

## What was changed for this assignment

The action's own behaviour is untouched: `src/` and `action.yml` still do what
upstream does, which is to render a GitHub activity feed into a README between
two markers.

Everything added is about *shipping* that software:

| Change | Why |
| --- | --- |
| `package.json`: added `name`, `version`, `main`, `license` | The pipeline derives release numbers from `version`; without it there is nothing to bump. |
| `package.json`: `build` switched from `bun install && bunx ncc` to `ncc` | The runner installs with `npm ci`, so the build must not depend on Bun being present. |
| `package.json`: added `test` and `lint` scripts | The pipeline refuses to build until both pass. |
| `test/templateEngine.test.js` | Upstream ships no tests. These cover the pure template functions so the matrix job tests something real. |
| `eslint.config.mjs` | Minimal flat config: correctness rules only, not style. |
| `.github/workflows/ci-dev.yml` | Build + dev release on every push to `main`. |
| `.github/workflows/cicd-pipeline.yml` | Three-stage pipeline with an AI release-notes step and rollback. |
| `scripts/compute_version.py` | Resolves the next semantic tag from `package.json` and existing tags. |
| `scripts/release_notes_agent.py` | The guarded agent that drafts release notes for the production reviewer. |
| `scripts/setup_environments.py` | Reproducible creation of the environments, variables, secrets and protection rules. |
| Upstream's own workflows removed | They push to upstream's README on a schedule; they are not part of this exercise. |
