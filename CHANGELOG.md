# Changelog

All notable changes to **jabr** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The canonical version is the
`metadata.version` field in [`SKILL.md`](SKILL.md) (mirrored by `package.json`).

## [Unreleased]

## [0.1.0] - 2026-06-22

### Added
- Initial release: a Claude-native stacked-pull-request skill built on plain `git` and the
  GitHub `gh` CLI, with a TypeScript engine run on [Bun](https://bun.sh).
- Engine (`scripts/jabr.ts`) with stack management: `init`, `create`, `modify`, `track`,
  `untrack`, `log`/`status`, navigation (`checkout`/`up`/`down`/`top`/`bottom`), `restack`,
  `move`, `rename`, `delete`, `squash`, `submit`, and `sync`.
- `SKILL.md` workflow guidance: stacking mental model, feature decomposition, the
  implementation loop, conflict/sync handling.
- Reference docs: `references/planning.md` (how to decompose a feature into a stack) and
  `references/workflow.md` (end-to-end examples, conflict recovery, manual equivalents for
  out-of-scope operations).
- Test suite (`bun test`) exercising the stack graph and restack logic against a temporary
  git repository.

[Unreleased]: https://github.com/ahmadatallah/jabr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ahmadatallah/jabr/releases/tag/v0.1.0
