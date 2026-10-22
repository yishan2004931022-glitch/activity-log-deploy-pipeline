# evidence/

Raw command output backing the Assignment 6 report. Nothing here is written by
hand; every file is the literal output of the script named beside it.

| File | Produced by | Shows |
| --- | --- | --- |
| `graph-main.txt` | `experiments/collect-evidence.sh` | `git log --graph --parents` for `main`, annotated |
| `graph-trimmed.txt` | `experiments/collect-evidence.sh` | the same graph, cut to the experiment commits |
| `merge-shapes.txt` | `experiments/collect-evidence.sh` | parent count per commit — which one is the merge |
| `ff-demo.txt` | `experiments/collect-evidence.sh` | `git merge --ff-only` succeeding, then refusing |
| `guard-demo.txt` | `experiments/collect-evidence.sh` | `check_merge_hygiene.py` and the pre-push hook refusing |
| `e1-rebase-attempt1.txt` | `experiments/resolve-e1.sh` | the rebase stopping on the Experiment 1 conflict |
| `e1-conflict-markers.txt` | `experiments/resolve-e1.sh` | the conflict exactly as git wrote it into the file |
| `e1-rerere-replay.txt` | `experiments/resolve-e1.sh` | `rerere` replaying the recorded resolution |
| `e1-rerere-status.txt` | `experiments/resolve-e1.sh` | `git rerere status` (empty — no conflict in progress) |
| `e1-range-diff.txt` | `experiments/resolve-e1.sh` | the commit before vs after the rebase |

## Regenerating

The five files from `collect-evidence.sh` can be reproduced from a clean clone:

```
bash experiments/collect-evidence.sh
```

The `e1-*` files cannot. That conflict was resolved once, during the rebase of
`exp1/dev-b-rebase`, on a branch that has since been merged — so they are
committed exactly as they were produced, next to `experiments/resolve-e1.sh`,
the script that produced them.
