/**
 * Typed wrappers around the `git` and `gh` command-line tools, plus shared
 * repository-state helpers.
 *
 * Every subprocess call in jabr goes through this module so that command
 * behaviour, error handling, and output capture stay consistent and testable.
 *
 * @packageDocumentation
 */

import { $ } from "bun";
import { fail } from "./logger";

/** The result of running a subprocess: exit code plus captured stdout/stderr. */
export interface RunResult {
  /** Process exit code (`0` on success). */
  code: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
}

/**
 * Internal dispatcher that spawns `git` or `gh` and captures its output.
 * @internal
 */
const runProcess = async (
  binary: "git" | "gh",
  args: string[],
): Promise<RunResult> => {
  const result =
    binary === "git"
      ? await $`git ${args}`.nothrow().quiet()
      : await $`gh ${args}`.nothrow().quiet();
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/**
 * Run a `git` command without throwing. Inspect {@link RunResult.code} yourself.
 *
 * @param args - Arguments passed to `git` (each element is shell-escaped).
 * @returns The captured {@link RunResult}.
 */
export const gitTry = (args: string[]): Promise<RunResult> =>
  runProcess("git", args);

/**
 * Run a `git` command, exiting via {@link fail} on a non-zero status.
 *
 * @param args - Arguments passed to `git`.
 * @returns The trimmed standard output on success.
 */
export const git = async (args: string[]): Promise<string> => {
  const result = await gitTry(args);
  if (result.code !== 0) {
    fail(`git ${args.join(" ")} failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
};

/**
 * Run a `gh` (GitHub CLI) command without throwing.
 *
 * @param args - Arguments passed to `gh`.
 * @returns The captured {@link RunResult}.
 */
export const ghTry = (args: string[]): Promise<RunResult> => runProcess("gh", args);

/**
 * Run a `gh` command, exiting via {@link fail} on a non-zero status.
 *
 * @param args - Arguments passed to `gh`.
 * @returns The trimmed standard output on success.
 */
export const gh = async (args: string[]): Promise<string> => {
  const result = await ghTry(args);
  if (result.code !== 0) {
    fail(`gh ${args.join(" ")} failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
};

/** Ensure the current working directory is inside a git repository, exiting if not. */
export const inRepo = async (): Promise<void> => {
  if ((await gitTry(["rev-parse", "--git-dir"])).code !== 0) {
    fail("not inside a git repository");
  }
};

/** Ensure the GitHub CLI (`gh`) is installed, exiting with install guidance if not. */
export const needGitHubCli = (): void => {
  if (!Bun.which("gh")) {
    fail("the GitHub CLI 'gh' is required for this command (https://cli.github.com)");
  }
};

/**
 * Return the name of the currently checked-out branch.
 *
 * @returns The short branch name.
 * @throws Exits via {@link fail} when `HEAD` is detached.
 */
export const currentBranch = async (): Promise<string> => {
  const result = await gitTry(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (result.code !== 0) fail("detached HEAD; checkout a branch first");
  return result.stdout.trim();
};

/**
 * Whether a local branch with the given name exists.
 *
 * @param branch - Branch name to test.
 */
export const branchExists = async (branch: string): Promise<boolean> =>
  (await gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

/**
 * List all local branch names.
 *
 * @returns Branch names in git's default ordering.
 */
export const allBranches = async (): Promise<string[]> => {
  const output = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  return output ? output.split("\n").filter(Boolean) : [];
};

/** Whether an `origin` remote is configured. */
export const hasOrigin = async (): Promise<boolean> =>
  (await gitTry(["remote", "get-url", "origin"])).code === 0;

/** Whether the working tree and index are both clean (no pending changes). */
export const isClean = async (): Promise<boolean> =>
  (await gitTry(["diff", "--quiet"])).code === 0 &&
  (await gitTry(["diff", "--cached", "--quiet"])).code === 0;

/**
 * Exit via {@link fail} unless the working tree is clean.
 *
 * Used before operations that rebase or move `HEAD`, where uncommitted changes
 * would be lost or cause confusing conflicts.
 */
export const requireClean = async (): Promise<void> => {
  if (!(await isClean())) {
    fail("working tree has uncommitted changes; commit or stash first");
  }
};
