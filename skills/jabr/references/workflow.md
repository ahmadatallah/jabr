# Workflow, recovery, and manual operations

A deeper reference for day-to-day use, conflict recovery, and operations the
engine does not automate. All commands assume the alias
`jabr='bun "${CLAUDE_PLUGIN_ROOT}"/scripts/jabr.ts'` (the `jabr` engine).

## End-to-end example

```bash
jabr init                                   # record the trunk (auto-detects main)

# build a three-branch stack
echo schema  > schema.sql && jabr create db-schema   -a -m "Add schema"
echo api     > api.ts     && jabr create api-layer   -a -m "Add API on the schema"
echo ui      > ui.tsx     && jabr create web-ui      -a -m "Wire UI to the API"

jabr log                                    # inspect the tree
jabr submit --stack                         # open a PR per branch

# review feedback lands on the API branch
jabr checkout api-layer
# ...edit api.ts...
jabr modify -a                              # amend + restack web-ui automatically
jabr submit --stack                         # update all PRs

# the bottom PR merges on GitHub
jabr sync --delete                          # ff trunk, drop db-schema, restack the rest
```

## How restacking stays exact

Each tracked branch stores the parent tip SHA it was last based on
(`branch.<name>.jabrBase`). Restacking runs:

```
git rebase --onto <parent's current tip> <stored base> <branch>
```

so only the branch's *own* commits are replayed onto the moved parent — the
parent's commits are never duplicated. After a successful rebase the stored base
is refreshed, and the branch's children are restacked in turn.

## Recovering from a conflict

A restack/modify/sync stops at the first branch that fails to rebase:

```
jabr: rebase conflict while restacking 'api-layer'.
  Resolve the conflicts, run 'git rebase --continue' (or '--abort'),
  then re-run 'jabr restack'.
```

Steps:

1. Fix the conflicted files in the working tree.
2. `git add` them, then `git rebase --continue` until the rebase finishes.
3. Re-run `jabr restack` to realign any branches above the one that conflicted.

If you'd rather back out, `git rebase --abort` returns the branch to its
pre-rebase state; the rest of the stack is untouched.

## Merge styles and `sync`

`sync` fast-forwards the trunk to `origin`, asks GitHub which PRs are `MERGED`,
and (with `--delete`) reparents each merged branch's children onto the trunk —
recording the merged tip as their base so the following restack drops the
now-merged commits.

- **Rebase / merge-commit landings**: the merged commits match what's on trunk, so
  the restack is clean.
- **Squash landings**: trunk has a single squashed commit instead of the originals.
  The restack still drops the originals from descendants; if a descendant touched
  the same lines you may get a conflict to resolve (see above).

`sync` without `--delete` only reports merged branches and restacks; it never
deletes anything.

## Operations the engine does not automate

Keep these manual to avoid surprising history rewrites:

- **Reorder** two branches in a stack — `jabr move --onto <target>` the branches
  into the order you want (move the lower one first), then `jabr restack`.
- **Split** a branch into two — commit the separable part on its own, create a new
  branch for the remainder, and `jabr track`/`move` to place it. Or, on the branch,
  `git rebase -i <parent>` to reorder/split commits, then `jabr restack` the
  descendants.
- **Absorb** a staged fix into an older branch — `jabr checkout` that branch,
  `jabr modify -a`, then `jabr restack`.
- **Merge queue / web review** — not provided; merge via GitHub and `jabr sync`.

## Metadata reference

Stored in the repo's local git config (nothing extra committed):

| Key | Meaning |
|-----|---------|
| `jabr.trunk` | The trunk branch |
| `branch.<name>.jabrParent` | The branch's parent in the stack |
| `branch.<name>.jabrBase` | The parent tip SHA the branch was last based on |

Inspect with `git config --local --get-regexp '^(jabr|branch\..*\.jabr)'`, or
clear a branch's tracking with `jabr untrack <name>`.
