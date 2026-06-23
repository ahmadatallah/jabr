/**
 * Coverage for the stack-engine edge cases the main suite doesn't reach: trunk
 * auto-detection fallbacks, a broken parent chain, the merge-base base fallback,
 * a missing parent, and a rebase conflict during restack.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";

import { git, gitTry } from "../scripts/lib/git";
import {
  baseKey,
  configSet,
  configUnset,
  detectTrunk,
  parentKey,
  restackBranch,
  stackRoot,
  trunk,
} from "../scripts/lib/stack";
import * as commands from "../scripts/lib/commands";
import { cleanupRepos, commitFile, expectExit, makeRepo } from "./helpers";

afterAll(async () => {
  await cleanupRepos();
});

test("detectTrunk falls back to origin/HEAD when no standard trunk exists", async () => {
  await makeRepo({ defaultBranch: "dev" });
  // No main/master/trunk and no origin/HEAD yet.
  expect(await detectTrunk()).toBe("");
  // Now point origin/HEAD at dev; detectTrunk should resolve it.
  await git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev"]);
  expect(await detectTrunk()).toBe("dev");
});

test("trunk exits when no trunk can be determined", async () => {
  await makeRepo({ defaultBranch: "dev" });
  await expectExit(() => trunk());
});

test("stackRoot returns empty for the trunk itself and for a broken chain", async () => {
  await makeRepo();
  await commands.init([]);
  expect(await stackRoot("main")).toBe("");

  await Bun.write("a.txt", "a\n");
  await commands.create(["feature-a", "-a", "-m", "add a"]);
  // Point the parent at a branch that itself has no recorded parent.
  await configSet(parentKey("feature-a"), "orphan");
  expect(await stackRoot("feature-a")).toBe("");
});

test("restackBranch falls back to merge-base when no base is stored", async () => {
  await makeRepo();
  await commands.init([]);
  await Bun.write("a.txt", "a\n");
  await commands.create(["feature-a", "-a", "-m", "add a"]);

  // Drop the stored base so restackBranch must compute the merge-base.
  await configUnset(baseKey("feature-a"));
  await git(["checkout", "-q", "main"]);
  await commitFile("main2.txt", "more\n", "advance main");

  await restackBranch("feature-a");
  const isAncestor = await gitTry(["merge-base", "--is-ancestor", "main", "feature-a"]);
  expect(isAncestor.code).toBe(0);
});

test("restackBranch exits when a recorded parent no longer exists", async () => {
  await makeRepo();
  await commands.init([]);
  await Bun.write("a.txt", "a\n");
  await commands.create(["feature-a", "-a", "-m", "add a"]);
  await Bun.write("b.txt", "b\n");
  await commands.create(["feature-b", "-a", "-m", "add b"]);

  // Delete the parent branch out from under feature-b.
  await git(["checkout", "-q", "main"]);
  await git(["branch", "-D", "feature-a"]);
  await expectExit(() => restackBranch("feature-b"));
});

test("restackBranch reports a rebase conflict and exits", async () => {
  await makeRepo();
  await commands.init([]);

  await Bun.write("shared.txt", "base\n");
  await commands.create(["feature-a", "-a", "-m", "add shared"]);

  await Bun.write("shared.txt", "from-b\n");
  await commands.create(["feature-b", "-a", "-m", "edit shared on b"]);

  // Advance feature-a with a conflicting change to the same file.
  await git(["checkout", "-q", "feature-a"]);
  await commitFile("shared.txt", "from-a\n", "edit shared on a");

  await expectExit(() => restackBranch("feature-b"));
  // Leave the temp repo in a clean-ish state for teardown.
  await gitTry(["rebase", "--abort"]);
});
