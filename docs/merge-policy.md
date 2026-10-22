# Merge policy

How changes get onto `main` in this repository, and why.

This document is the team's working agreement. It is deliberately a file in
the repository rather than a wiki page, so that changing the policy is itself
a pull request that someone has to review.

## Status

| Field | Value |
| --- | --- |
| Owner | PM |
| Last reviewed | 2026-10-21 |
| Applies to | `main` |
| Required check | `gate` |

## The rules

1. Nothing lands on `main` without a pull request.
2. A pull request cannot merge until the `gate` check passes.
3. Catch up with `main` by rebasing, not by merging it into your branch.

## Default merge style

Default merge style: **Squash and merge**, with one exception. Squash is the default because a squashed commit reverts with a plain `git revert <sha>` and `git bisect` lands on whole changes. Use **Rebase and merge** when the individual commits are the reviewable unit - a migration applied in deliberate steps, for example. **Merge commits** are reserved for integrating a long-lived branch, where losing the fact that it was a branch would misrepresent the history.

## Rationale

Measured on this repository's own history, not from a blog post. See
`evidence/` for the raw output.

| | Merge commit | Squash | Rebase |
| --- | --- | --- | --- |
| Commits added to `main` per PR | n + 1 | 1 | n |
| Parents of the resulting commit | **2** | 1 | 1 |
| Shows in `git log --graph` that a branch existed | yes | no | no |
| Reverting it | `git revert -m 1 <sha>` | `git revert <sha>` | one revert per commit |
| `git bisect` behaviour | must pick a side at each merge | lands on a whole change | lands on each step |
| Commit hashes survive | yes | no | no |

The revert row is the one that settled it. Reverting a merge commit needs
`-m 1` to say which parent to keep, and getting that number wrong reverts the
other side of the history - which is a thing people do at the worst possible
moment, under pressure, during an incident. A squashed commit reverts with no
flags at all.

The bisect row is the runner-up. `git bisect` over the five rebased commits in
this experiment lands on one small change at a time; over a merge commit it
has to descend into a branch that was never on `main` on its own.

## Fast-forward

Fast-forward is not a fourth button. It is a property the history either has
or has not got by the time you reach the merge, and GitHub never offers it:
every merge button writes a new commit. `evidence/ff-demo.txt` shows the same
`git merge --ff-only` succeeding when the target has not moved and refusing -
`fatal: Not possible to fast-forward, aborting` - once it has.

It is also unavailable on `main` here by construction: branch protection
forbids direct pushes, and a fast-forward is a push, not a merge.

## Revert procedure

A squashed or rebased commit reverts with `git revert <sha>`. A merge
commit needs `git revert -m 1 <sha>`, where `1` means "keep the first
parent", and getting that number wrong reverts the opposite side of the
history. That asymmetry is the main practical argument against merge
commits for routine changes.

## Open questions

- Which style keeps `git bisect` most useful?
- Which style makes a bad change easiest to revert?
- What do we lose, in each style, when we need to audit who changed what?
