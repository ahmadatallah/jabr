/**
 * Coverage for the GitHub-facing handlers (`submit`, `sync`). These run fully
 * offline: pushes go to a local bare repository acting as `origin`, and a fake
 * `gh` on PATH (see helpers) drives pull-request state from disk.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as commands from "../scripts/lib/commands";
import { git } from "../scripts/lib/git";
import { parentOf } from "../scripts/lib/stack";
import {
  captureStdout,
  cleanupRepos,
  expectExit,
  installFakeGh,
  makeBareOrigin,
  makeRepo,
  seedPr,
} from "./helpers";

let ghState = "";

const stackBranch = async (name: string, file: string, message: string): Promise<void> => {
  await Bun.write(file, `${name}\n`);
  await commands.create([name, "-a", "-m", message]);
};

const readPr = (branch: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ghState, `pr-${encodeURIComponent(branch)}.json`), "utf8"));

beforeEach(async () => {
  await makeRepo();
  await commands.init([]);
  ghState = await installFakeGh();
});

afterAll(async () => {
  await cleanupRepos();
});

// --- submit -----------------------------------------------------------------

test("submit pushes, opens PRs with wired bases, and writes the nav block", async () => {
  await makeBareOrigin();
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await captureStdout(() => commands.submit([])); // current is feature-b -> lineage a,b

  const prA = readPr("feature-a");
  const prB = readPr("feature-b");
  expect(prA.base).toBe("main");
  expect(prB.base).toBe("feature-a");
  expect(String(prA.body)).toContain("jabr:begin");
  expect(String(prB.body)).toContain("this PR");

  // Re-submitting updates existing PRs and replaces (not duplicates) the nav block.
  await captureStdout(() => commands.submit(["--stack"]));
  const body = String(readPr("feature-b").body);
  expect(body.match(/jabr:begin/g)?.length).toBe(1);
});

test("submit --draft on a pre-existing PR edits it and updates the seeded nav", async () => {
  await makeBareOrigin();
  await stackBranch("feature-a", "a.txt", "add a");
  // Pre-existing PR whose body already carries a (stale) nav block.
  await seedPr(ghState, "feature-a", {
    number: 5,
    body: "Intro\n\n<!-- jabr:begin -->\nold\n<!-- jabr:end -->",
  });

  await captureStdout(() => commands.submit(["--stack", "--draft"]));
  const pr = readPr("feature-a");
  expect(pr.base).toBe("main");
  expect(String(pr.body)).toContain("Intro");
  expect(String(pr.body)).not.toContain("\nold\n");
});

test("submit with --no-push only syncs PR metadata", async () => {
  await makeBareOrigin();
  await stackBranch("feature-a", "a.txt", "add a");
  await captureStdout(() => commands.submit(["--no-push"]));
  expect(existsSync(join(ghState, "pr-feature-a.json"))).toBe(true);
});

test("submit validates its preconditions and flags", async () => {
  // unknown flag (checked after origin/cli are present)
  await makeBareOrigin();
  await stackBranch("feature-a", "a.txt", "add a");
  await expectExit(() => commands.submit(["--bogus"]));

  // on the trunk: not part of a stack
  await git(["checkout", "-q", "main"]);
  await expectExit(() => commands.submit([]));
});

test("submit exits when there is no origin remote", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await expectExit(() => commands.submit([]));
});

test("submit reports a failed push", async () => {
  await makeBareOrigin();
  await git(["remote", "set-url", "origin", "/nonexistent/jabr-origin.git"]);
  await stackBranch("feature-a", "a.txt", "add a");
  await expectExit(() => commands.submit([]));
});

// --- sync -------------------------------------------------------------------

test("sync fast-forwards the trunk and restacks when nothing is merged", async () => {
  await makeBareOrigin();
  await git(["push", "-q", "origin", "main"]);
  await stackBranch("feature-a", "a.txt", "add a");
  await git(["checkout", "-q", "main"]);

  await captureStdout(() => commands.sync([]));
  // feature-a still tracked and rebased on main.
  expect(await parentOf("feature-a")).toBe("main");
});

test("sync reports merged PRs and, with --delete, removes and reparents them", async () => {
  await makeBareOrigin();
  await git(["push", "-q", "origin", "main"]);
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await seedPr(ghState, "feature-a", { number: 1, state: "MERGED" });
  await seedPr(ghState, "feature-b", { number: 2, state: "OPEN" });

  // Report-only first.
  const report = await captureStdout(() => commands.sync([]));
  expect(report).toBe(""); // diagnostics go through the (silenced) logger
  expect(await parentOf("feature-b")).toBe("feature-a");

  // Now delete from the merged branch itself (exercises the "follow current" path).
  await git(["checkout", "-q", "feature-a"]);
  await captureStdout(() => commands.sync(["--delete"]));
  expect(await parentOf("feature-b")).toBe("main");
});

test("sync without an origin skips the fetch", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await git(["checkout", "-q", "main"]);
  await captureStdout(() => commands.sync([]));
  expect(await parentOf("feature-a")).toBe("main");
});

test("sync exits when the trunk has diverged from origin", async () => {
  await makeBareOrigin();
  await git(["push", "-q", "origin", "main"]);
  // Rewrite local main so it can no longer fast-forward to origin/main.
  await git(["commit", "-q", "--amend", "-m", "rewritten root"]);
  await expectExit(() => commands.sync([]));
});

test("sync requires a clean working tree", async () => {
  await Bun.write("root.txt", "dirty\n");
  await git(["add", "-A"]);
  await expectExit(() => commands.sync([]));
});
