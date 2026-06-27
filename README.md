<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="jabr" width="150" />
  </picture>
</p>

# Jabr

<p align="center">
  <a href="https://github.com/ahmadatallah/jabr/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ahmadatallah/jabr/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/ahmadatallah/jabr/actions/workflows/ci.yml"><img alt="Coverage" src="https://img.shields.io/badge/coverage-100%25-brightgreen" /></a>
  <a href="https://ahmadatallah.github.io/jabr/"><img alt="Docs" src="https://img.shields.io/badge/docs-TypeDoc-3178c6?logo=readthedocs&logoColor=white" /></a>
  <a href="https://github.com/ahmadatallah/jabr/releases"><img alt="Version" src="https://img.shields.io/github/package-json/v/ahmadatallah/jabr?label=version&color=blue" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" /></a>
</p>

> **jabr** (Arabic, جَبْر — "the reunion of broken parts"; the root of *al-jabr → algebra*).
> Reunite a feature's broken-down pieces into one clean, reviewable whole.

A Claude-native **stacked pull request** workflow — implemented entirely with plain `git`
and the GitHub `gh` CLI. No external service, no account, no daemon. It ships as a
[Claude Code **agent skill**](https://agentskills.io) plus a self-contained TypeScript
engine you can also drive by hand.

Instead of one giant pull request, you break a feature into a **stack** of small, dependent
PRs — each one reviewable on its own, each branched off the one below it. `jabr` tracks the
parent/child graph, restacks (rebases) descendants when a lower branch changes, and submits
the whole stack to GitHub with correct base branches and a navigation comment.

## Why stack?

- **Smaller diffs → faster, better reviews.** A 1,500-line PR gets rubber-stamped; five
  300-line PRs get read.
- **Unblock yourself.** Keep building on top of work that's still in review.
- **Logical history.** Each PR is one coherent change (schema → backend → API → UI → tests).

## What makes it Claude-native

Claude is the operator. It **plans the decomposition**, **writes the code on each branch**,
and **authors the PR descriptions** — while this engine handles the deterministic git/`gh`
mechanics (parent tracking, `rebase --onto`, force-push ordering, PR base wiring) reliably.

## Requirements

- [Bun](https://bun.sh) — the engine is a TypeScript program run directly with Bun (no
  build step, zero runtime dependencies)
- A git repository
- [`gh`](https://cli.github.com) authenticated (`gh auth login`) — only needed for
  `submit`/`sync`; all local stack operations work without it

## Install

`jabr` is distributed as a Claude Code **plugin**. Add this repo as a marketplace and
install it — Claude Code then loads the skill automatically (and it also auto-activates
from its description):

```text
/plugin marketplace add ahmadatallah/jabr
/plugin install jabr@jabr
```

Pin a tagged version if you prefer: `/plugin marketplace add ahmadatallah/jabr@v0.1.0`.

[Bun](https://bun.sh) and (for `submit`/`sync`) an authenticated [`gh`](https://cli.github.com)
are still required on your machine — the plugin can't install them for you.

To run the engine by hand for development, clone the repo and alias the script directly:

```bash
git clone https://github.com/ahmadatallah/jabr.git
alias jabr='bun /path/to/jabr/scripts/jabr.ts'
```

## Quick start

```bash
jabr init                      # detect/record the trunk (main)
jabr create api-schema -a -m "Add user schema + migration"
#   ...edit code...
jabr create api-endpoints -a -m "Add /users endpoints on the schema"
#   ...edit code...
jabr create api-ui -a -m "Wire the users list UI to the endpoints"

jabr log                       # see the stack
jabr submit --stack            # push + open a PR per branch, bases wired, nav comment added
```

Address review feedback on a lower branch, then realign everything above it:

```bash
jabr down                      # move to the parent branch
#   ...fix code...
jabr modify -a                 # amend + auto-restack all descendants
jabr submit --stack            # update all PRs
```

After a branch merges:

```bash
jabr sync                      # ff trunk, drop merged commits, restack the rest, prompt-delete
```

## Command reference

| Command | What it does |
|---|---|
| `init [trunk]` | Set/auto-detect the trunk branch |
| `create <name> [-a] [-m msg]` | Branch off current HEAD, track parent, optionally stage+commit |
| `modify [-a] [-m msg] [-c]` | Amend (or `-c` new) commit on current branch, then restack descendants |
| `track <name> [--parent p]` / `untrack [name]` | Add/remove a branch from the stack |
| `log` / `status` | Show the stack tree (current `*`, commits ahead of parent) |
| `parent` / `children` / `trunk` | Inspect the graph |
| `checkout <b>` · `up [-n]` · `down [-n]` · `top` · `bottom` | Navigate the stack |
| `restack [branch]` | Rebase a branch and all its descendants onto their parents |
| `move --onto <target>` | Reparent the current branch onto a new target, restack descendants |
| `rename [old] <new>` | Rename a branch and fix children's metadata |
| `delete <name>` | Delete a branch, reparent its children onto its parent |
| `squash [-m msg]` | Collapse a branch's commits into one, restack descendants |
| `submit [--stack] [--draft] [--no-push]` | Push + create/update a PR per branch with correct bases + stack nav |
| `sync [--delete]` | Fetch, fast-forward trunk, detect merged PRs, restack, prompt-delete |

## How it works

Stack metadata lives in your repo's **local git config** — nothing extra to commit:

- `jabr.trunk` — the trunk branch
- `branch.<b>.jabrParent` — that branch's parent in the stack
- `branch.<b>.jabrBase` — the parent's tip SHA when `<b>` was last based on it

Restacking uses `git rebase --onto <new-parent-tip> <stored-base> <branch>`, so only the
branch's *own* commits are replayed onto the moved parent — no duplicates.

## Out of scope

`jabr` deliberately stops at what plain git + `gh` can do well. Anything that needs a hosted
service — a merge queue, a web review UI, server-side stack management — is out of scope.
Merge through GitHub as usual, then `jabr sync`. See
[`references/workflow.md`](skills/jabr/references/workflow.md) for how to do less-common operations
(reorder, split, absorb) by hand.

## Development

```bash
bun install            # dev deps (TypeScript + Bun types) for typecheck/tests
bun test               # run the test suite
bun test --coverage    # run with the coverage report (gated at 100%)
bun run typecheck      # tsc --noEmit
```

### Project status

| Aspect | Status | Source of truth |
|---|---|---|
| **Tests / coverage** | 100% lines & functions, enforced in CI | `bun test --coverage` + `coverageThreshold = 1.0` in [`bunfig.toml`](bunfig.toml) |
| **CI** | Typecheck + tests on every push/PR | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| **Docs** | TypeDoc API reference auto-published to GitHub Pages | [`.github/workflows/docs.yml`](.github/workflows/docs.yml) → <https://ahmadatallah.github.io/jabr/> |
| **Version** | Semantic Versioning, released by a bot | [`package.json`](package.json) · automated by [`.github/workflows/release.yml`](.github/workflows/release.yml) |

The coverage badge is a fixed **100%** because CI fails the build if coverage
drops below the threshold — so it can never silently go stale.

### Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please). Commit using
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`chore:`, …); on every push to `main` the bot opens/updates a **release PR** that
bumps the version (in `package.json`, [`SKILL.md`](skills/jabr/SKILL.md), and
`scripts/jabr.ts`) and updates the [changelog](CHANGELOG.md). Merging that PR
tags the version and publishes a GitHub Release.

The release workflow is **restricted to the repository owner** — it only runs
when the actor pushing/merging to `main` is the repo owner
(`if: github.actor == github.repository_owner`).

## License

The `jabr` source code is licensed under [MIT](LICENSE).

