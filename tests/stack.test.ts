/**
 * Integration tests for the jabr stack engine.
 *
 * Each test runs against a fresh temporary git repository (created in
 * `beforeEach`) and drives the real command handlers, so we exercise the actual
 * git plumbing rather than mocks. Coverage is deliberately scoped to the logic
 * that can go wrong — the branch graph and the restack/rebase maths — and omits
 * the `gh`-dependent paths (`submit`, the merge-detection half of `sync`) which
 * need a live GitHub remote.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as commands from "../scripts/lib/commands";
import { branchExists, currentBranch, git, gitTry } from "../scripts/lib/git";
import { logger } from "../scripts/lib/logger";
import {
  ancestors,
  baseOf,
  childrenOf,
  parentOf,
  stackRoot,
  trunk,
  walk,
} from "../scripts/lib/stack";

// Keep test output readable: only surface warnings and errors from the logger.
logger.level = 1;

const originalCwd = process.cwd();
const tempRepos: string[] = [];

/** Stage everything and commit, relative to the current working directory. */
const commitFile = async (name: string, content: string, message: string): Promise<void> => {
  await Bun.write(name, content);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", message]);
};

/** Create a stacked branch (on the current branch) carrying one new commit. */
const stackBranch = async (name: string, file: string, message: string): Promise<void> => {
  await Bun.write(file, `${name}\n`);
  await commands.create([name, "-a", "-m", message]);
};

/** Number of commits reachable from `to` but not `from`. */
const countBetween = async (from: string, to: string): Promise<number> =>
  Number(await git(["rev-list", "--count", `${from}..${to}`]));

/** Whether `maybeAncestor` is an ancestor of `descendant`. */
const isAncestor = async (maybeAncestor: string, descendant: string): Promise<boolean> =>
  (await gitTry(["merge-base", "--is-ancestor", maybeAncestor, descendant])).code === 0;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "jabr-test-"));
  tempRepos.push(dir);
  process.chdir(dir);
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "jabr test"]);
  await commitFile("root.txt", "root\n", "root");
  await commands.init([]);
});

afterAll(async () => {
  process.chdir(originalCwd);
  for (const dir of tempRepos) await rm(dir, { recursive: true, force: true });
});

test("init records the trunk", async () => {
  expect(await trunk()).toBe("main");
});

test("create stacks a branch and records its parent + base", async () => {
  const baseSha = await git(["rev-parse", "HEAD"]);
  await stackBranch("feature-a", "a.txt", "add a");
  expect(await currentBranch()).toBe("feature-a");
  expect(await parentOf("feature-a")).toBe("main");
  expect(await baseOf("feature-a")).toBe(baseSha);
});

test("graph helpers reflect the stack shape", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  expect(await childrenOf("feature-a")).toEqual(["feature-b"]);
  expect(await ancestors("feature-b")).toEqual(["feature-b", "feature-a"]);
  expect(await stackRoot("feature-b")).toBe("feature-a");
  expect(await walk("feature-a")).toEqual(["feature-a", "feature-b"]);
});

test("restack rebases descendants onto a moved parent without duplicating commits", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await git(["checkout", "-q", "main"]);
  await commitFile("main2.txt", "more\n", "advance main");
  await git(["checkout", "-q", "feature-b"]);
  await commands.restack([]);

  expect(await countBetween("main", "feature-a")).toBe(1);
  expect(await countBetween("feature-a", "feature-b")).toBe(1);
  expect(await isAncestor("main", "feature-b")).toBe(true);
});

test("modify amends in place and restacks descendants", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await git(["checkout", "-q", "feature-a"]);
  await Bun.write("a.txt", "a edited\n");
  await commands.modify(["-a"]);

  expect(await countBetween("main", "feature-a")).toBe(1); // amended, still one commit
  expect(await countBetween("feature-a", "feature-b")).toBe(1);
  expect(await isAncestor("feature-a", "feature-b")).toBe(true);
});

test("squash collapses a branch's commits into one", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await git(["checkout", "-q", "feature-a"]);
  await commitFile("a2.txt", "a2\n", "second commit");
  expect(await countBetween("main", "feature-a")).toBe(2);

  await commands.squash(["-m", "squashed"]);
  expect(await countBetween("main", "feature-a")).toBe(1);
});

test("move reparents a branch and replays only its own commits", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await git(["checkout", "-q", "main"]);
  await stackBranch("feature-x", "x.txt", "add x");

  await git(["checkout", "-q", "feature-x"]);
  await commands.move(["--onto", "feature-a"]);

  expect(await parentOf("feature-x")).toBe("feature-a");
  expect(await isAncestor("feature-a", "feature-x")).toBe(true);
  expect(await countBetween("feature-a", "feature-x")).toBe(1);
});

test("rename updates the branch and its children's parent pointer", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await commands.rename(["feature-a", "core"]);
  expect(await branchExists("core")).toBe(true);
  expect(await branchExists("feature-a")).toBe(false);
  expect(await parentOf("core")).toBe("main");
  expect(await parentOf("feature-b")).toBe("core");
});

test("delete removes a branch and reparents its children onto the parent", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await git(["checkout", "-q", "main"]);
  await commands.deleteBranch(["feature-a"]);
  expect(await branchExists("feature-a")).toBe(false);
  expect(await parentOf("feature-b")).toBe("main");

  // realigning should drop the deleted parent's commit, leaving only feature-b's own
  await git(["checkout", "-q", "feature-b"]);
  await commands.restack([]);
  expect(await countBetween("main", "feature-b")).toBe(1);
});
