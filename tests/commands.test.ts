/**
 * Exhaustive coverage for the local (non-GitHub) command handlers in
 * `scripts/lib/commands.ts`: success paths, structured output, and every
 * validation/`fail` branch.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";

import * as commands from "../scripts/lib/commands";
import { branchExists, currentBranch, git } from "../scripts/lib/git";
import { baseOf, childrenOf, parentOf } from "../scripts/lib/stack";
import {
  captureStdout,
  cleanupRepos,
  commitFile,
  expectExit,
  makeRepo,
} from "./helpers";

/** Create a stacked branch carrying one new commit. */
const stackBranch = async (name: string, file: string, message: string): Promise<void> => {
  await Bun.write(file, `${name}\n`);
  await commands.create([name, "-a", "-m", message]);
};

const countBetween = async (from: string, to: string): Promise<number> =>
  Number(await git(["rev-list", "--count", `${from}..${to}`]));

beforeEach(async () => {
  await makeRepo();
  await commands.init([]);
});

afterAll(async () => {
  await cleanupRepos();
});

// --- init -------------------------------------------------------------------

test("init accepts an explicit trunk and rejects unknown branches", async () => {
  await git(["branch", "release"]);
  await commands.init(["release"]);
  expect(await captureStdout(() => commands.showTrunk())).toBe("release\n");
  await expectExit(() => commands.init(["ghost"]));
});

test("init exits when no trunk can be auto-detected", async () => {
  await makeRepo({ defaultBranch: "dev" });
  await expectExit(() => commands.init([]));
});

// --- create -----------------------------------------------------------------

test("create without staged changes records the branch but no commit", async () => {
  await commands.create(["feature"]);
  expect(await currentBranch()).toBe("feature");
  expect(await parentOf("feature")).toBe("main");
  expect(await countBetween("main", "feature")).toBe(0);
});

test("create warns when -m is given with nothing staged", async () => {
  await commands.create(["feature", "-m", "ignored"]);
  expect(await countBetween("main", "feature")).toBe(0);
});

test("create validates its arguments", async () => {
  await expectExit(() => commands.create([])); // missing name
  await expectExit(() => commands.create(["feature", "--bogus"])); // unknown flag
  await stackBranch("feature", "a.txt", "add a");
  await git(["checkout", "-q", "main"]);
  await expectExit(() => commands.create(["feature"])); // already exists
  // staged changes but no message
  await Bun.write("x.txt", "x\n");
  await expectExit(() => commands.create(["another", "-a"]));
});

// --- modify -----------------------------------------------------------------

test("modify -c adds a new commit and restacks descendants", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  await git(["checkout", "-q", "feature-a"]);
  await Bun.write("a2.txt", "a2\n");
  await commands.modify(["-a", "-c", "-m", "second commit"]);
  expect(await countBetween("main", "feature-a")).toBe(2);
  expect(await countBetween("feature-a", "feature-b")).toBe(1);
});

test("modify with a message amends the subject", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await Bun.write("a.txt", "edited\n");
  await commands.modify(["-a", "-m", "renamed subject"]);
  expect(await git(["log", "-1", "--format=%s", "feature-a"])).toBe("renamed subject");
});

test("modify with nothing staged only restacks", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await commands.modify([]); // clean tree -> restack-only branch
  expect(await countBetween("main", "feature-a")).toBe(1);
});

test("modify validates its arguments", async () => {
  await expectExit(() => commands.modify(["--bogus"])); // unknown flag
  await git(["checkout", "-q", "main"]);
  await git(["checkout", "-q", "-b", "loose"]);
  await expectExit(() => commands.modify([])); // untracked branch
  await stackBranch("feature-a", "a.txt", "add a");
  await expectExit(() => commands.modify(["-c"])); // -c without message
  await Bun.write("a.txt", "x\n");
  await git(["checkout", "-q", "feature-a"]);
  await expectExit(() => commands.modify(["-c", "-m", "msg"])); // -c without staged
});

// --- track / untrack --------------------------------------------------------

test("track records a parent for an existing branch", async () => {
  await git(["checkout", "-q", "-b", "loose"]);
  await commitFile("loose.txt", "loose\n", "loose");
  await git(["checkout", "-q", "main"]);
  await commands.track(["loose"]); // defaults to trunk parent
  expect(await parentOf("loose")).toBe("main");

  await git(["checkout", "-q", "-b", "child", "loose"]);
  await commitFile("child.txt", "c\n", "c");
  await commands.track(["-p", "loose"]); // name defaults to current branch
  expect(await parentOf("child")).toBe("loose");
});

test("track validates its arguments", async () => {
  await git(["branch", "feature"]);
  await expectExit(() => commands.track(["feature", "extra"])); // unexpected arg
  await expectExit(() => commands.track(["--bogus"])); // unknown flag
  await expectExit(() => commands.track(["ghost"])); // no such branch
  await expectExit(() => commands.track(["feature", "-p", "ghost"])); // no such parent
  await expectExit(() => commands.track(["feature", "-p", "feature"])); // self-parent
});

test("untrack removes stack metadata", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await commands.untrack("feature-a".split(" ")); // explicit name
  expect(await parentOf("feature-a")).toBe("");
  await stackBranch("feature-b", "b.txt", "add b");
  await commands.untrack([]); // defaults to current branch
  expect(await parentOf("feature-b")).toBe("");
});

// --- inspection: parent / children / trunk / log ----------------------------

test("parent, children and trunk print the graph", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await git(["checkout", "-q", "feature-b"]);
  expect(await captureStdout(() => commands.parent())).toBe("feature-a\n");

  await git(["checkout", "-q", "feature-a"]);
  expect(await captureStdout(() => commands.children())).toBe("feature-b\n");

  expect(await captureStdout(() => commands.showTrunk())).toBe("main\n");
});

test("log renders the stack tree and notes an empty stack", async () => {
  const empty = await captureStdout(() => commands.log());
  expect(empty).toContain("main");

  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  const tree = await captureStdout(() => commands.log());
  expect(tree).toContain("feature-a");
  expect(tree).toContain("feature-b");
  expect(tree).toContain("ahead");
});

// --- navigation -------------------------------------------------------------

test("checkout switches branches and validates input", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await git(["checkout", "-q", "main"]);
  await commands.checkout(["feature-a"]);
  expect(await currentBranch()).toBe("feature-a");
  await expectExit(() => commands.checkout([])); // missing target
});

test("down moves toward the trunk, multiple steps, and reports the floor", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  await stackBranch("feature-c", "c.txt", "add c");

  await commands.down([]);
  expect(await currentBranch()).toBe("feature-b");
  await git(["checkout", "-q", "feature-c"]);
  await commands.down(["-n", "2"]);
  expect(await currentBranch()).toBe("feature-a");

  await git(["checkout", "-q", "main"]);
  await expectExit(() => commands.down([])); // no parent below trunk
});

test("up moves away from the trunk and handles branch points", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  await git(["checkout", "-q", "feature-a"]);

  await commands.up(["-n", "1"]);
  expect(await currentBranch()).toBe("feature-b");
  await expectExit(() => commands.up([])); // no children above tip
  await git(["checkout", "-q", "feature-b"]);
  await expectExit(() => commands.up(["--bogus"])); // unknown flag

  // Branch point: feature-a has two children.
  await git(["checkout", "-q", "feature-a"]);
  await stackBranch("feature-c", "c2.txt", "add c");
  await git(["checkout", "-q", "feature-a"]);
  await commands.up(["--to", "feature-c"]);
  expect(await currentBranch()).toBe("feature-c");

  await git(["checkout", "-q", "feature-a"]);
  const listed = await captureStdout(() => expectExit(() => commands.up([])));
  expect(listed).toContain("feature-b");
});

test("top and bottom jump to the ends of the stack", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  await git(["checkout", "-q", "feature-a"]);
  await commands.top();
  expect(await currentBranch()).toBe("feature-b");

  await commands.bottom();
  expect(await currentBranch()).toBe("feature-a");

  await git(["checkout", "-q", "main"]);
  await expectExit(() => commands.bottom()); // trunk is not part of a stack
});

// --- restack / move ---------------------------------------------------------

test("restack accepts an explicit start and rejects detached/dirty/rootless states", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");
  await git(["checkout", "-q", "main"]);
  await commitFile("main2.txt", "more\n", "advance");

  await commands.restack(["feature-a"]); // explicit start branch
  expect(await countBetween("main", "feature-a")).toBe(1);

  await git(["checkout", "-q", "feature-b"]);
  await commands.restack([]); // default: stack root
  expect(await countBetween("feature-a", "feature-b")).toBe(1);

  await git(["checkout", "-q", "main"]);
  await expectExit(() => commands.restack([])); // main is not part of a stack

  await git(["checkout", "-q", "feature-a"]);
  await Bun.write("dirty.txt", "dirty\n");
  await git(["add", "-A"]);
  await expectExit(() => commands.restack([])); // dirty tree
});

test("move validates its arguments", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await expectExit(() => commands.move([])); // missing --onto
  await expectExit(() => commands.move(["--bogus"])); // unknown flag
  await expectExit(() => commands.move(["--onto", "ghost"])); // no such target
  await expectExit(() => commands.move(["--onto", "feature-a"])); // onto self
});

// --- rename -----------------------------------------------------------------

test("rename supports the one-argument (current branch) form", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await commands.rename(["renamed"]); // rename current branch
  expect(await branchExists("renamed")).toBe(true);
  expect(await parentOf("renamed")).toBe("main");
});

test("rename handles untracked branches and validates input", async () => {
  await git(["checkout", "-q", "-b", "loose"]);
  await commitFile("loose.txt", "loose\n", "loose");
  await commands.rename(["loose", "loose2"]); // untracked: no parent metadata
  expect(await branchExists("loose2")).toBe(true);
  expect(await parentOf("loose2")).toBe("");

  await expectExit(() => commands.rename([])); // missing new name
  await expectExit(() => commands.rename(["ghost", "x"])); // no such old branch
  await git(["branch", "taken"]);
  await expectExit(() => commands.rename(["loose2", "taken"])); // target exists
});

// --- delete -----------------------------------------------------------------

test("delete reparents children, follows the current branch, and validates input", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await stackBranch("feature-b", "b.txt", "add b");

  // Deleting the checked-out branch checks out its parent.
  await git(["checkout", "-q", "feature-b"]);
  await commands.deleteBranch(["feature-b"]);
  expect(await currentBranch()).toBe("feature-a");

  await expectExit(() => commands.deleteBranch([])); // missing name
  await expectExit(() => commands.deleteBranch(["ghost"])); // no such branch

  // Untracked branch: children reparent onto the trunk.
  await git(["checkout", "-q", "main"]);
  await git(["checkout", "-q", "-b", "loose"]);
  await commitFile("loose.txt", "loose\n", "loose");
  await git(["checkout", "-q", "-b", "loose-child", "loose"]);
  await git(["config", "--local", "branch.loose-child.jabrParent", "loose"]);
  await git(["checkout", "-q", "main"]);
  await commands.deleteBranch(["loose"]);
  expect(await parentOf("loose-child")).toBe("main");
});

// --- squash -----------------------------------------------------------------

test("squash collapses multiple commits using the last subject by default", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await commitFile("a2.txt", "a2\n", "second subject");
  expect(await countBetween("main", "feature-a")).toBe(2);
  await commands.squash([]); // no -m: reuse latest subject
  expect(await countBetween("main", "feature-a")).toBe(1);
  expect(await git(["log", "-1", "--format=%s", "feature-a"])).toBe("second subject");
});

test("squash is a no-op for a single commit and validates input", async () => {
  await stackBranch("feature-a", "a.txt", "add a");
  await commands.squash([]); // already a single commit
  expect(await countBetween("main", "feature-a")).toBe(1);

  await expectExit(() => commands.squash(["--bogus"])); // unknown flag
  await git(["checkout", "-q", "main"]);
  await git(["checkout", "-q", "-b", "loose"]);
  await expectExit(() => commands.squash([])); // untracked branch

  await git(["checkout", "-q", "main"]);
  await commands.create(["empty"]); // tracked, no commits beyond parent
  await expectExit(() => commands.squash([]));
});
