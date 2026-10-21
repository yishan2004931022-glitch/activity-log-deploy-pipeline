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
