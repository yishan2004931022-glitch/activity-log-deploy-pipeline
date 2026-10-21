# activity-log — deployment pipeline

[![CI Dev Deployment](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-dev.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-dev.yml)
[![CI/CD Deployment Pipeline](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/cicd-pipeline.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/cicd-pipeline.yml)
[![Build-Test-Release](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/build-test-release.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/build-test-release.yml)

[![PR Checks](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-pr.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-pr.yml)

A multi-stage GitHub Actions deployment pipeline built around the
[activity-log](https://github.com/TheDanniCraft/activity-log) action as its base
software. See [`UPSTREAM.md`](UPSTREAM.md) for exactly what was taken and what
was changed.

NTUST DevOps — Assignments 4 and 5. Author: Yi-Shan Chen (Selina Chen),
student ID B11233030.

## The pipeline

```
ci-dev.yml          push to main ──► build ──► deploy-dev            (no gate)

cicd-pipeline.yml   manual run ──► version ──► test (Node 20 │ 22)
                                                    │
                                                    ▼
                                                  build
                                                    │
                                                    ▼
                                            deploy-staging
                                                    │
                                                    ▼
                                      ai-release-notes  (read-only agent)
                                                    │
                                                    ▼
                                    ⏸  deploy-production  ← human approval
                                                    │
                                          rollback ◄┘  on failure


build-test-release.yml   push to main ──► version ──► build
or a manual run                                         │
                                                        ▼
                                        test-unit  (ubuntu │ macOS × Node 20 │ 22)
                                                   │         │
                                        coverage ◄─┘         └─► test-integration
                                            │                     (runs the built
                                            │                      artifact, not src)
                                            └──────────┬──────────┘
                                                       ▼
                                               deploy-staging
                                                       │
                                                       ▼
                                     ⏸  deploy-production  ← human approval
                                                       │
                                               report ◄┘  always
```

`staging` and `production` publish the **same artifact**. Only the tag, the
release notes and the environment secret used to sign it differ.

## Environments

| Environment | `BUILD_TAG` | Secret | Protection |
| --- | --- | --- | --- |
| `dev` | `dev-v1.0` | `DEPLOY_SIGNING_KEY` | none — dev tracks `main` |
| `staging` | `staging-v1.0` | `DEPLOY_SIGNING_KEY` | none |
| `production` | `prod-v1.0` | `DEPLOY_SIGNING_KEY` | **required reviewer** + wait timer |
| `ai-review` | — (`AI_MODEL`) | `AI_API_KEY` | not a deployment target; a scoped secret store |

`BUILD_TAG` supplies the *channel*; the pipeline supplies the *number*, so a
release never depends on somebody remembering to edit a variable. `staging-v1.0`
plus a resolved version of `1.0.3` becomes the tag `staging-v1.0.3`.

Environment setup is reproducible rather than hand-clicked:

```bash
GH_TOKEN=<token> REPO=<owner/name> python3 scripts/setup_environments.py
```

## Running it

```bash
npm ci
npm run lint              # eslint, correctness rules only
npm run test:unit         # 49 unit tests, pure functions
npm run build             # ncc bundle into dist/
npm run test:integration  # 10 tests, runs dist/index.js against a stub API
npm run test:coverage     # c8, writes coverage/coverage-summary.json
```

The dev release happens automatically on push to `main`. The full pipeline is
started from the Actions tab (*CI/CD Deployment Pipeline → Run workflow*); tick
**Stop after staging** to rehearse without touching production.

## Testing and the release gates

Two layers, two different jobs, two different failure meanings. The full
rationale is in [`TESTING.md`](TESTING.md); the short version:

| Layer | What it runs | What it can catch |
| --- | --- | --- |
| Unit | imports from `src/`, 4 matrix legs | logic regressions, runtime differences |
| Integration | runs `dist/index.js` from the build artifact | bundling faults, input handling, HTTP and file behaviour |

A **failing test** fails its job, so every release job is skipped by `needs`.
**Low coverage** does not fail anything — the coverage job reports a number and
the release jobs skip *themselves* with an `if:`, because unverified is not the
same as broken.

Both gates can be demonstrated without committing anything: run
*Build-Test-Release → Run workflow* and either tick **simulate_test_failure**
or set **coverage_threshold** to `95`.

## The AI step

`ai-release-notes` drafts the notes the production reviewer reads before
approving. It runs with `contents: read` and nothing else, so
it cannot create a release, move a tag or touch a deployment. Its output is an
artifact a human opens at the approval gate. Commit text is treated as untrusted
input: it is fenced inside a per-run nonce, the system prompt forbids following
instructions found inside the fence, and the generated text is screened for
approval or command language before it is shown. If the model is unreachable the
job still emits a plain commit listing, clearly labelled as not AI-generated, so
the pipeline never blocks on the agent.

Details and the prompt itself: [`scripts/release_notes_agent.py`](scripts/release_notes_agent.py).

## Licence

MIT, inherited from upstream. See [`LICENSE`](LICENSE).
