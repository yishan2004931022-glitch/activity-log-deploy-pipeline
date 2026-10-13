# Testing and the release gates

NTUST DevOps, Assignment 5. This file explains what is tested, where each test
runs in the pipeline, and what happens when something does not pass.

## Two layers, and why they are not the same thing

| | Unit | Integration |
| --- | --- | --- |
| Lives in | `test/unit/` | `test/integration/` |
| Imports from `src/` | yes | **no** |
| What it executes | pure functions | `dist/index.js` as a child process |
| Needs the build artifact | no | **yes** |
| Network | none | a local stub GitHub API on `127.0.0.1` |
| Count | 49 tests | 10 tests |
| Where in the pipeline | after build, on 4 matrix legs | after the unit stage |

The distinction is the point of the assignment, so it is worth being exact
about it.

The **unit** suite imports `applyTemplate`, `extractEventData` and
`src/config.js` and asserts on return values. It is fast, deterministic, and it
fails for exactly one reason: somebody changed the logic. `src/config.js` reads
its inputs at module load, so each test case loads it fresh with a cache-busting
query string on the import specifier — one import per scenario.

The **integration** suite imports nothing from `src/` at all. It:

1. deletes the committed `dist/`,
2. downloads `build-artifact` from the build job and verifies its `sha256`,
3. unpacks it,
4. starts a stub HTTP server implementing the three GitHub endpoints the action
   calls,
5. spawns `node dist/index.js` with `INPUT_*` environment variables and
   `GITHUB_API_URL` pointing at the stub — exactly the contract the real runner
   uses,
6. asserts on what the action printed and on whether it touched the filesystem.

Step 1 is what makes the claim honest. `dist/` is committed, as it is for any
published JavaScript action, so without deleting it first a failed download
would silently fall back to the committed bundle and the suite would still pass.

### What only the integration layer can catch

- a module dropped by `ncc`, or a dynamic import that does not survive bundling
- a wrong `main` in `package.json` or a wrong entry point in `action.yml`
- input parsing that works on a parsed object but not on `INPUT_*` strings
- the action exiting `0` when it should have failed, or the reverse
- two modules that are each correct but disagree — a `WatchEvent` is rendered
  with a star or a bell depending on whether a *different* endpoint says the
  repository is starred. That assertion needs both endpoints to agree, so no
  unit test can make it.

All of those pass every unit test.

## The two gates

```
failing test   ->  the job FAILS
                   -> deploy-staging and deploy-production are skipped by `needs`
                   -> an issue is opened automatically
                   -> nothing is published

low coverage   ->  the coverage job SUCCEEDS and publishes a number
                   -> deploy-staging and deploy-production skip THEMSELVES via
                      `if: needs.coverage.outputs.ok == 'true'`
                   -> nothing is published, and the report job says why
```

They are deliberately different mechanisms, because they mean different things.
A failing test means the code is known to be wrong. Thin coverage means the code
might be wrong and nobody would find out. Treating the second as an outage would
train people to ignore it; treating the first as a warning would ship bugs.

`scripts/coverage_gate.js` never exits non-zero for this reason: measuring is
its job, deciding is the workflow's.

## Coverage scope

The gate measures **line coverage of the two modules the unit suite is
responsible for**: `src/config.js` and `src/utils/templateEngine.js`. The scope
is set in the `c8` block of `package.json`, with `all: true`, so the number
covers every line of those files whether or not a test happened to load them.

Current: **93% lines**, 83% branches, 96% functions. Threshold: **80%**.

The remaining modules — `src/index.js`, `src/utils/github.js`,
`src/utils/file.js`, `src/utils/octokit.js` — are not in that scope, and
inflating the number by adding them with `all: true` and no tests would have
been dishonest in the other direction. They are covered by the integration
suite instead, at the level that matters for them: they are mostly network and
filesystem glue, and the integration tests exercise them through the built
bundle against a stub API. c8 cannot instrument a child process launched this
way, so their coverage is demonstrated by behaviour rather than counted by a
tool.

## Demonstrating the gates

Neither demonstration requires committing a broken test. From the Actions tab,
*Build-Test-Release → Run workflow*:

| Input | Value | What you should see |
| --- | --- | --- |
| *(defaults)* | | every stage green, `staging-v1.0.x` then `prod-v1.0.x` after approval |
| `simulate_test_failure` | ✅ | unit stage red on all 4 legs, everything after it **skipped**, no release |
| `coverage_threshold` | `95` | all tests green, coverage job green, both deploys **skipped**, report explains why |

`scripts/gate_check.js` is what makes the first one possible. It is a separate
npm script rather than a test file, so the real suites cannot be made to fail by
setting an environment variable, and the test glob never picks it up.

## Running everything locally

```bash
npm ci
npm run lint
npm run test:unit
npm run build            # integration tests need dist/
npm run test:integration
npm run test:coverage
node scripts/coverage_gate.js coverage/coverage-summary.json 80
```

## Reports

The coverage job uploads a `test-reports` artifact containing:

- `coverage/lcov.info` — for any tool that reads lcov
- `coverage/lcov-report/` — the browsable HTML report
- `coverage/coverage-summary.json` — what the gate reads
- `reports/unit-junit.xml` — JUnit XML, for CI dashboards that expect it

JUnit generation lives in the coverage job rather than the matrix because
`node --test --test-reporter=junit` needs Node 21.6 or newer, and the matrix
includes Node 20 on purpose.
