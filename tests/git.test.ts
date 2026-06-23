/**
 * Unit tests for the subprocess wrappers and repository-state helpers in
 * `scripts/lib/git.ts`, including the non-zero-exit (`fail`) paths.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import {
  allBranches,
  branchExists,
  currentBranch,
  gh,
  ghTry,
  git,
  gitTry,
  hasOrigin,
  inRepo,
  isClean,
  needGitHubCli,
  requireClean,
} from "../scripts/lib/git";
import {
  cleanupRepos,
  commitFile,
  expectExit,
  installFakeGh,
  makeBareOrigin,
  makeRepo,
} from "./helpers";

beforeEach(async () => {
  await makeRepo();
});

afterAll(async () => {
  await cleanupRepos();
});

test("git returns trimmed stdout and gitTry surfaces exit codes", async () => {
  expect(await git(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  const ok = await gitTry(["rev-parse", "HEAD"]);
  expect(ok.code).toBe(0);
  const bad = await gitTry(["rev-parse", "definitely-not-a-ref"]);
  expect(bad.code).not.toBe(0);
});

test("git exits when the command fails", async () => {
  const exit = await expectExit(() => git(["rev-parse", "definitely-not-a-ref"]));
  expect(exit.code).toBe(1);
});

test("inRepo passes inside a repo and exits outside one", async () => {
  await inRepo(); // current dir is a repo
  process.chdir(tmpdir());
  await expectExit(() => inRepo());
});

test("currentBranch reports the branch and exits on detached HEAD", async () => {
  expect(await currentBranch()).toBe("main");
  await commitFile("second.txt", "two\n", "second");
  await git(["checkout", "-q", "HEAD~1"]); // detach
  await expectExit(() => currentBranch());
});

test("branchExists and allBranches reflect the refs", async () => {
  expect(await branchExists("main")).toBe(true);
  expect(await branchExists("nope")).toBe(false);
  await git(["branch", "feature"]);
  expect((await allBranches()).sort()).toEqual(["feature", "main"]);
});

test("hasOrigin tracks whether an origin remote exists", async () => {
  expect(await hasOrigin()).toBe(false);
  await makeBareOrigin();
  expect(await hasOrigin()).toBe(true);
});

test("isClean and requireClean track the working tree", async () => {
  expect(await isClean()).toBe(true);
  await requireClean(); // clean: no throw
  await Bun.write("root.txt", "dirty\n");
  expect(await isClean()).toBe(false);
  await expectExit(() => requireClean());
});

test("gh wrappers run the CLI and report failures", async () => {
  const state = await installFakeGh();
  await Bun.write(`${state}/pr-x.json`, JSON.stringify({ number: 7 }));
  expect(await gh(["pr", "view", "x", "--json", "number"])).toBe('{"number":7}');
  const missing = await ghTry(["pr", "view", "missing", "--json", "number"]);
  expect(missing.code).not.toBe(0);
  await expectExit(() => gh(["pr", "view", "missing", "--json", "number"]));
});

test("needGitHubCli passes when gh is present and exits when absent", async () => {
  await installFakeGh(); // sets JABR_GH_BIN
  needGitHubCli(); // no throw via the override
  const savedBin = process.env.JABR_GH_BIN;
  const savedPath = process.env.PATH;
  delete process.env.JABR_GH_BIN;
  process.env.PATH = ""; // no gh discoverable on an empty PATH
  try {
    await expectExit(async () => needGitHubCli());
  } finally {
    if (savedBin !== undefined) process.env.JABR_GH_BIN = savedBin;
    process.env.PATH = savedPath;
  }
});
