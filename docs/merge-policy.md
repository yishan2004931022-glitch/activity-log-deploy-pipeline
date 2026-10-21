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

To be filled in once the team has compared the options on real history.

## Open questions

- Which style keeps `git bisect` most useful?
- Which style makes a bad change easiest to revert?
- What do we lose, in each style, when we need to audit who changed what?
