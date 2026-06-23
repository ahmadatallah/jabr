/**
 * Shared test harness for the jabr suite.
 *
 * Provides an in-process testing environment that exercises the *real* command
 * handlers against throwaway git repositories:
 *
 * - `process.exit` is replaced with a throwing stub so the `fail()` paths can be
 *   asserted instead of tearing down the test runner.
 * - {@link captureStdout} intercepts the structured output the handlers print.
 * - {@link makeRepo} / {@link makeBareOrigin} spin up disposable git repos (and a
 *   local "remote") so `submit`/`sync` run fully offline.
 * - A fake `gh` executable is placed on `PATH` so the GitHub paths are driven by
 *   on-disk state rather than the network.
 *
 * Importing this module installs the global overrides as a side effect.
 */

import { mkdtemp, rm, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git } from "../scripts/lib/git";
import { logger } from "../scripts/lib/logger";

// Silence diagnostics; the tests assert on thrown ProcessExit / captured stdout.
logger.level = -1;

/** Error thrown by the stubbed `process.exit`, carrying the requested code. */
export class ProcessExit extends Error {
  readonly code: number;
  constructor(code?: number) {
    super(`process.exit(${code ?? 0})`);
    this.name = "ProcessExit";
    this.code = code ?? 0;
  }
}

// Replace process.exit so fail() throws instead of killing the test process.
process.exit = ((code?: number): never => {
  throw new ProcessExit(code);
}) as typeof process.exit;

/**
 * Assert that an async operation triggers a `fail()` (i.e. a stubbed
 * `process.exit`). Returns the captured {@link ProcessExit} for further checks.
 */
export const expectExit = async (fn: () => Promise<unknown>): Promise<ProcessExit> => {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ProcessExit) return error;
    throw error;
  }
  throw new Error("expected the operation to exit, but it succeeded");
};

/** Run `fn`, returning everything it writes to `process.stdout`. */
export const captureStdout = async (fn: () => Promise<unknown>): Promise<string> => {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join("");
};

// Captured before any test chdir's away, so teardown can return to a real dir.
const rootCwd = process.cwd();
const tempDirs: string[] = [];

/** Remove every temporary directory created by the helpers and restore cwd. */
export const cleanupRepos = async (): Promise<void> => {
  process.chdir(rootCwd);
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs.length = 0;
};

/** Make and register a temporary directory (auto-removed by {@link cleanupRepos}). */
const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

/**
 * Create a fresh git repository with one root commit, chdir into it, and return
 * its path. Does not run `jabr init` (callers decide the trunk).
 */
export const makeRepo = async (
  options: { defaultBranch?: string } = {},
): Promise<string> => {
  const branch = options.defaultBranch ?? "main";
  const dir = await makeTempDir("jabr-test-");
  process.chdir(dir);
  await git(["init", "-q", "-b", branch]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "jabr test"]);
  await Bun.write("root.txt", "root\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "root"]);
  return dir;
};

/** Create a bare repository to act as a local `origin` and wire it up. */
export const makeBareOrigin = async (): Promise<string> => {
  const bare = await makeTempDir("jabr-origin-");
  await git(["init", "-q", "--bare", bare]);
  await git(["remote", "add", "origin", bare]);
  return bare;
};

/** Stage everything and commit in the current repo. */
export const commitFile = async (
  name: string,
  content: string,
  message: string,
): Promise<void> => {
  await Bun.write(name, content);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", message]);
};

// --- fake gh executable -----------------------------------------------------

/**
 * A tiny stand-in for the GitHub CLI. It persists one JSON file per PR under
 * `$FAKE_GH_STATE` so that `pr create` / `pr edit` / `pr view` behave
 * statefully, just like the real flow jabr relies on. Numbers are handed out
 * from a counter file. Unsupported invocations exit non-zero.
 */
const FAKE_GH_SOURCE = String.raw`#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = process.env.FAKE_GH_STATE ?? ".";
const prFile = (branch) => join(dir, "pr-" + encodeURIComponent(branch) + ".json");
const readPr = (branch) =>
  existsSync(prFile(branch)) ? JSON.parse(readFileSync(prFile(branch), "utf8")) : null;
const writePr = (branch, pr) => writeFileSync(prFile(branch), JSON.stringify(pr));
const counterFile = join(dir, "counter");
const nextNumber = () => {
  const current = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) : 0;
  const next = current + 1;
  writeFileSync(counterFile, String(next));
  return next;
};
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args[0] === "pr" && args[1] === "view") {
  const branch = args[2];
  const pr = readPr(branch);
  if (!pr) process.exit(1);
  const fields = (valueAfter("--json") ?? "").split(",").filter(Boolean);
  const out = {};
  for (const field of fields) out[field] = pr[field];
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "create") {
  const head = valueAfter("--head");
  const pr = readPr(head) ?? {};
  pr.number = pr.number ?? nextNumber();
  pr.base = valueAfter("--base");
  pr.state = pr.state ?? "OPEN";
  pr.body = pr.body ?? "";
  pr.draft = args.includes("--draft");
  writePr(head, pr);
  process.stdout.write("https://example.test/pr/" + pr.number + "\n");
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "edit") {
  const branch = args[2];
  const pr = readPr(branch) ?? { number: nextNumber(), state: "OPEN", body: "" };
  const base = valueAfter("--base");
  if (base !== undefined) pr.base = base;
  const body = valueAfter("--body");
  if (body !== undefined) pr.body = body;
  writePr(branch, pr);
  process.exit(0);
}

process.exit(2);
`;

let fakeGhPath = "";

/**
 * Install the fake `gh` (once) by pointing `JABR_GH_BIN` at it, and return a
 * fresh state directory for the current test (also set as `FAKE_GH_STATE`).
 *
 * `JABR_GH_BIN` is used instead of `PATH` because Bun's shell and `Bun.which`
 * snapshot `PATH` at startup and ignore later mutations.
 */
export const installFakeGh = async (): Promise<string> => {
  if (!fakeGhPath) {
    // Not registered with the temp-dir cleanup: the fake gh must outlive any
    // single file's teardown so later test files can still use it.
    const dir = await mkdtemp(join(tmpdir(), "jabr-ghbin-"));
    fakeGhPath = join(dir, "gh");
    await writeFile(fakeGhPath, FAKE_GH_SOURCE);
    await chmod(fakeGhPath, 0o755);
  }
  process.env.JABR_GH_BIN = fakeGhPath;
  const state = await makeTempDir("jabr-ghstate-");
  await mkdir(state, { recursive: true });
  process.env.FAKE_GH_STATE = state;
  return state;
};

/** Seed a PR record in the fake gh state (e.g. an already-open or merged PR). */
export const seedPr = async (
  state: string,
  branch: string,
  pr: Record<string, unknown>,
): Promise<void> => {
  await writeFile(
    join(state, `pr-${encodeURIComponent(branch)}.json`),
    JSON.stringify({ number: 1, state: "OPEN", body: "", ...pr }),
  );
};
