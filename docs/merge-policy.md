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

## The rules

1. Nothing lands on `main` without a pull request.
2. A pull request cannot merge until the `gate` check passes.
3. Catch up with `main` by rebasing, not by merging it into your branch.

## Default merge style

Default merge style: **Squash and merge**. One commit per pull request keeps `main` readable and makes `git bisect` land on whole changes rather than half-finished ones.

## Rationale

To be filled in once the team has compared the options on real history.

## Open questions

- Which style keeps `git bisect` most useful?
- Which style makes a bad change easiest to revert?
- What do we lose, in each style, when we need to audit who changed what?
