# Planning a stack

The hard, valuable part of stacking is the *decomposition*: turning one feature
into an ordered sequence of small, dependent changes. Do this before creating any
branches, and confirm it with the user.

## Principles

- **One coherent change per branch.** A reviewer should be able to describe each
  PR in a single sentence. If you need "and" to describe it, consider splitting.
- **Order by dependency, bottom-up.** Lower branches must not depend on higher
  ones. Foundations first, then the things built on them.
- **Each branch should build and pass its own tests.** A stack of green PRs is far
  easier to review and to merge incrementally.
- **Prefer smaller.** ~200–400 lines per PR is a good target. Five small PRs beat
  one large one even if the total diff is identical.
- **Keep refactors separate from behavior changes.** A pure-refactor branch under
  a feature branch keeps both diffs readable.

## A typical ordering

For a backend-to-frontend feature:

1. **Schema / migration** — data model, database migration.
2. **Data layer** — repositories/queries built on the schema.
3. **API / business logic** — endpoints or services using the data layer.
4. **UI** — components/screens calling the API.
5. **Tests / docs** — end-to-end coverage and documentation (often folded into the
   branches above instead).

Not every feature fits this shape — order by *what depends on what*, not by a
fixed template.

## Worked example

> "Add the ability for users to archive projects."

A reasonable stack:

| # | Branch | Change |
|---|--------|--------|
| 1 | `archive-schema` | Add `archived_at` column + migration |
| 2 | `archive-api` | `POST /projects/:id/archive` + unarchive endpoints |
| 3 | `archive-list-filter` | Exclude archived projects from the default list query |
| 4 | `archive-ui` | Archive button + "Archived" filter in the project list |

Each branch is independently reviewable, builds on the one below, and tells a
clear story. Branch 3 depends on 1 (the column) but not on 2, so it could also be
stacked directly on branch 1 if you want it reviewed in parallel with the API.

## Translating the plan into commands

```bash
bun ~/.claude/skills/jabr/scripts/jabr.ts init
# implement schema, then:
bun ~/.claude/skills/jabr/scripts/jabr.ts create archive-schema -a -m "Add archived_at column + migration"
# implement api, then:
bun ~/.claude/skills/jabr/scripts/jabr.ts create archive-api -a -m "Add archive/unarchive endpoints"
# ...and so on, then:
bun ~/.claude/skills/jabr/scripts/jabr.ts submit --stack
```

## When you discover a unit is too big

While implementing, if a branch grows beyond one coherent change, split it: commit
the logically-separable part, then use `move`/`create` to lift it into its own
branch, or finish the branch and follow the split guidance in
[workflow.md](workflow.md).
