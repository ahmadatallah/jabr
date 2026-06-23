#!/usr/bin/env bun
/**
 * jabr command-line entry point.
 *
 * Parses `process.argv`, dispatches to the matching handler in the `commands`
 * module, and renders top-level help. Run via `bun scripts/jabr.ts <command>`
 * (or the `jabr` bin once installed).
 *
 * @packageDocumentation
 */

import * as commands from "./lib/commands";
import { fail, logger } from "./lib/logger";

/** The package version, mirrored by `package.json` and `SKILL.md`'s `metadata.version`. */
export const VERSION = "0.1.0"; // x-release-please-version

/** Print top-level usage to stdout. */
const usage = (): void => {
  process.stdout.write(
    `jabr ${VERSION} — Claude-native stacked pull requests on plain git + gh

USAGE
  jabr <command> [args]

STACK
  init [trunk]                  set / auto-detect the trunk branch
  create <name> [-a] [-m msg]   new branch on current HEAD (track parent; optional commit)
  modify [-a] [-m msg] [-c]     amend (or -c new) commit, then restack descendants
  track <name> [-p parent]      start tracking an existing branch
  untrack [name]                stop tracking a branch
  squash [-m msg]               collapse a branch's commits into one, restack descendants
  move --onto <target>          reparent current branch, restack descendants
  rename [old] <new>            rename a branch, fix metadata
  delete <name>                 delete a branch, reparent its children

NAVIGATE / INSPECT
  log | status                  show the stack tree
  parent | children | trunk     inspect the graph
  checkout <branch>             switch branch
  up [-n N] [--to branch] | down [-n N] | top | bottom

GITHUB
  restack [branch]              rebase a branch + descendants onto their parents
  submit [-s] [--draft] [--no-push]   push + create/update PRs (bases + nav)
  sync [-d | --delete]          fast-forward trunk, drop merged, restack remaining

  help | version
`,
  );
};

/** Parse arguments and run the requested command. */
export const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "init":
      await commands.init(rest);
      break;
    case "create":
      await commands.create(rest);
      break;
    case "modify":
      await commands.modify(rest);
      break;
    case "track":
      await commands.track(rest);
      break;
    case "untrack":
      await commands.untrack(rest);
      break;
    case "squash":
      await commands.squash(rest);
      break;
    case "move":
      await commands.move(rest);
      break;
    case "rename":
      await commands.rename(rest);
      break;
    case "delete":
    case "rm":
      await commands.deleteBranch(rest);
      break;
    case "parent":
      await commands.parent();
      break;
    case "children":
      await commands.children();
      break;
    case "trunk":
      await commands.showTrunk();
      break;
    case "log":
    case "ls":
    case "status":
      await commands.log();
      break;
    case "checkout":
    case "co":
      await commands.checkout(rest);
      break;
    case "up":
      await commands.up(rest);
      break;
    case "down":
      await commands.down(rest);
      break;
    case "top":
      await commands.top();
      break;
    case "bottom":
      await commands.bottom();
      break;
    case "restack":
      await commands.restack(rest);
      break;
    case "submit":
      await commands.submit(rest);
      break;
    case "sync":
      await commands.sync(rest);
      break;
    case "version":
    case "-v":
    case "--version":
      process.stdout.write(`jabr ${VERSION}\n`);
      break;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      usage();
      break;
    default:
      fail(`unknown command: ${command} (try 'jabr help')`);
  }
};

/** Run {@link main}, reporting any uncaught error through the logger and exiting non-zero. */
export const run = (): Promise<void> =>
  main().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

// Only auto-run when invoked directly (e.g. `bun scripts/jabr.ts`), not when
// imported by the test suite.
if (import.meta.main) void run();
