# activity-log — deployment pipeline

[![CI Dev Deployment](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-dev.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/ci-dev.yml)
[![CI/CD Deployment Pipeline](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/cicd-pipeline.yml/badge.svg)](https://github.com/yishan2004931022-glitch/activity-log-deploy-pipeline/actions/workflows/cicd-pipeline.yml)

A multi-stage GitHub Actions deployment pipeline built around the
[activity-log](https://github.com/TheDanniCraft/activity-log) action as its base
software. See [`UPSTREAM.md`](UPSTREAM.md) for exactly what was taken and what
was changed.

NTUST DevOps — Assignment 4. Author: Yi-Shan Chen (Selina Chen).

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
npm run lint        # eslint, correctness rules only
npm test            # 11 unit tests over the template engine
npm run build       # ncc bundle into dist/
```

The dev release happens automatically on push to `main`. The full pipeline is
started from the Actions tab (*CI/CD Deployment Pipeline → Run workflow*); tick
**Stop after staging** to rehearse without touching production.

## The AI step

`ai-release-notes` drafts the notes the production reviewer reads before
approving. It runs with `contents: read` and `models: read` and nothing else, so
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
