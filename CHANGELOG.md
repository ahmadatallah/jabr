# Changelog

All notable changes to **jabr** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The canonical version is the
`metadata.version` field in [`SKILL.md`](SKILL.md) (mirrored by `package.json`).

## [0.1.2](https://github.com/ahmadatallah/jabr/compare/v0.1.1...v0.1.2) (2026-06-27)


### Features

* distribute jabr as a Claude Code plugin via marketplace ([#2](https://github.com/ahmadatallah/jabr/issues/2)) ([0806a0b](https://github.com/ahmadatallah/jabr/commit/0806a0b43734f84a6958da7095cc08670a879b37))

## [0.1.1](https://github.com/ahmadatallah/jabr/compare/v0.1.0...v0.1.1) (2026-06-23)


### Features

* **engine:** support JABR_GIT_BIN/JABR_GH_BIN overrides and add hasGitHubCli() ([a7c88a3](https://github.com/ahmadatallah/jabr/commit/a7c88a32bd016ace5225a160aadd02a512a0717a))

## [Unreleased]

### Added
- 100% test coverage of the stack engine and CLI, including the `gh`-driven
  `submit`/`sync` paths (exercised offline via a local bare remote and a fake
  `gh`) and every `fail()`/error branch. Coverage is enforced in CI at 100%
  (`coverageThreshold = 1.0` in `bunfig.toml`).
- README status badges (CI, coverage, docs, version) and a project-status table.
- Automated releases via [release-please](https://github.com/googleapis/release-please)
  (`.github/workflows/release.yml`): Conventional Commits drive version bumps,
  changelog updates, tags, and GitHub Releases.

### Changed
- `git.ts` resolves the `git`/`gh` binaries through optional `JABR_GIT_BIN` /
  `JABR_GH_BIN` overrides, and exposes `hasGitHubCli()` for CLI detection.

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
