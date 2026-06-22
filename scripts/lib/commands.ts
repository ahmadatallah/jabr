/**
 * Command handlers — one exported function per `jabr` subcommand.
 *
 * Each handler receives the already-sliced argument list (everything after the
 * command word), validates it, and performs the operation via the `git` and
 * `stack` modules. Diagnostics go through the `logger`; structured data is
 * written directly to stdout.
 *
 * @packageDocumentation
 */

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
  needGitHubCli,
  requireClean,
} from "./git";
import { colors, fail, logger } from "./logger";
import {
  ancestors,
  baseKey,
  baseOf,
  childrenOf,
  configSet,
  configUnset,
  detectTrunk,
  isTracked,
  parentKey,
  parentOf,
  restackBranch,
  stackRoot,
  TRUNK_KEY,
  trunk,
  walk,
} from "./stack";

// --- markers + glyphs used to splice the stack-navigation block into PR bodies
const NAV_BEGIN = "<!-- jabr:begin -->";
const NAV_END = "<!-- jabr:end -->";
/** Unicode glyph heading the stack block (U+25C6 BLACK DIAMOND). */
const NAV_HEADING_GLYPH = "◆";
/** Unicode glyph marking the current PR (U+25B8 BLACK RIGHT-POINTING SMALL TRIANGLE). */
const NAV_CURRENT_GLYPH = "▸";
/** Unicode arrow used in the "this PR" annotation (U+2190 LEFTWARDS ARROW). */
const NAV_THIS_PR_ARROW = "←";

/** Set or auto-detect the trunk branch and record it in git config. */
export const init = async (args: string[]): Promise<void> => {
  await inRepo();
  let trunkBranch = args[0] ?? "";
  if (!trunkBranch) trunkBranch = await detectTrunk();
  if (!trunkBranch) fail("specify the trunk branch: jabr init <branch>");
  if (!(await branchExists(trunkBranch))) fail(`no such branch: ${trunkBranch}`);
  await configSet(TRUNK_KEY, trunkBranch);
  logger.success(`trunk set to '${trunkBranch}'`);
};

/** Create a new branch on top of the current one, optionally staging + committing. */
export const create = async (args: string[]): Promise<void> => {
  await inRepo();
  let name = "";
  let stageAll = false;
  let message = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-a" || arg === "--all") stageAll = true;
    else if (arg === "-m" || arg === "--message") message = args[(index += 1)] ?? "";
    else if (arg?.startsWith("-")) fail(`unknown flag for create: ${arg}`);
    else if (!name) name = arg ?? "";
    else fail(`unexpected argument: ${arg}`);
  }
  if (!name) fail("usage: jabr create <branch> [-a] [-m message]");
  if (await branchExists(name)) fail(`branch '${name}' already exists`);

  const parent = await currentBranch();
  const baseSha = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "-q", "-b", name]);
  await configSet(parentKey(name), parent);
  await configSet(baseKey(name), baseSha);

  if (stageAll) await git(["add", "-A"]);
  const hasStaged = (await gitTry(["diff", "--cached", "--quiet"])).code !== 0;
  if (hasStaged) {
    if (!message) fail("staged changes present; pass a commit message with -m");
    await git(["commit", "-q", "-m", message]);
    logger.success(`created '${name}' on '${parent}' and committed`);
  } else {
    if (message) logger.warn("nothing staged to commit (-m ignored)");
    logger.success(`created '${name}' on '${parent}'`);
  }
};

/** Amend (or, with `-c`, add) a commit on the current branch, then restack descendants. */
export const modify = async (args: string[]): Promise<void> => {
  await inRepo();
  let stageAll = false;
  let message = "";
  let newCommit = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-a" || arg === "--all") stageAll = true;
    else if (arg === "-m" || arg === "--message") message = args[(index += 1)] ?? "";
    else if (arg === "-c" || arg === "--commit") newCommit = true;
    else fail(`unknown flag for modify: ${arg}`);
  }

  const branch = await currentBranch();
  if (!(await isTracked(branch))) fail(`'${branch}' is not a tracked branch`);
  if (stageAll) await git(["add", "-A"]);
  const hasStaged = (await gitTry(["diff", "--cached", "--quiet"])).code !== 0;

  if (newCommit) {
    if (!message) fail('a new commit needs a message: jabr modify -c -m "..."');
    if (!hasStaged) fail("nothing staged to commit");
    await git(["commit", "-q", "-m", message]);
  } else if (hasStaged) {
    if (message) await git(["commit", "-q", "--amend", "-m", message]);
    else await git(["commit", "-q", "--amend", "--no-edit"]);
  } else {
    logger.info("no staged changes; restacking descendants only");
  }

  for (const child of await childrenOf(branch)) await restackBranch(child);
  await gitTry(["checkout", "-q", branch]);
  logger.success("modify complete (descendants restacked)");
};

/** Start tracking an existing branch by recording its parent. */
export const track = async (args: string[]): Promise<void> => {
  await inRepo();
  let name = "";
  let parent = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-p" || arg === "--parent") parent = args[(index += 1)] ?? "";
    else if (arg?.startsWith("-")) fail(`unknown flag for track: ${arg}`);
    else if (!name) name = arg ?? "";
    else fail(`unexpected argument: ${arg}`);
  }
  if (!name) name = await currentBranch();
  if (!(await branchExists(name))) fail(`no such branch: ${name}`);
  if (!parent) parent = await trunk();
  if (!(await branchExists(parent))) fail(`no such parent branch: ${parent}`);
  if (parent === name) fail("a branch cannot be its own parent");
  await configSet(parentKey(name), parent);
  await configSet(baseKey(name), await git(["merge-base", parent, name]));
  logger.success(`tracking '${name}' with parent '${parent}'`);
};

/** Stop tracking a branch (removes its stack metadata). */
export const untrack = async (args: string[]): Promise<void> => {
  await inRepo();
  const name = args[0] ?? (await currentBranch());
  await configUnset(parentKey(name));
  await configUnset(baseKey(name));
  logger.success(`untracked '${name}'`);
};

/** Print the current branch's parent (stdout). */
export const parent = async (): Promise<void> => {
  await inRepo();
  const value = await parentOf(await currentBranch());
  if (value) process.stdout.write(`${value}\n`);
};

/** Print the current branch's direct children (stdout, one per line). */
export const children = async (): Promise<void> => {
  await inRepo();
  for (const child of await childrenOf(await currentBranch())) {
    process.stdout.write(`${child}\n`);
  }
};

/** Print the trunk branch (stdout). */
export const showTrunk = async (): Promise<void> => {
  await inRepo();
  process.stdout.write(`${await trunk()}\n`);
};

/** Recursively render a branch and its descendants as an indented tree. @internal */
const printTree = async (
  branch: string,
  depth: number,
  current: string,
): Promise<void> => {
  const indent = "  ".repeat(depth);
  const parentBranch = await parentOf(branch);
  const counted = await gitTry(["rev-list", "--count", `${parentBranch}..${branch}`]);
  const ahead = counted.code === 0 ? counted.stdout.trim() : "?";
  const label =
    branch === current ? colors.bold(colors.green(`* ${branch}`)) : `  ${branch}`;
  const meta = colors.dim(`(${ahead} ahead of ${parentBranch})`);
  process.stdout.write(`${indent}${label}  ${meta}\n`);
  for (const child of await childrenOf(branch)) {
    await printTree(child, depth + 1, current);
  }
};

/** Render the full stack tree, with the trunk at the root and the current branch marked. */
export const log = async (): Promise<void> => {
  await inRepo();
  const trunkBranch = await trunk();
  const current = await currentBranch();
  process.stdout.write(`${colors.cyan(trunkBranch)} ${colors.dim("(trunk)")}\n`);
  let found = false;
  for (const branch of (await allBranches()).sort()) {
    if ((await parentOf(branch)) === trunkBranch) {
      await printTree(branch, 1, current);
      found = true;
    }
  }
  if (!found) logger.info("no tracked branches yet — create one with 'jabr create <name>'");
};

/** Check out a branch by name. */
export const checkout = async (args: string[]): Promise<void> => {
  await inRepo();
  const target = args[0] ?? "";
  if (!target) fail("usage: jabr checkout <branch>");
  await git(["checkout", target]);
};

/** Move toward the trunk (to the parent), optionally several steps. */
export const down = async (args: string[]): Promise<void> => {
  await inRepo();
  let steps = 1;
  if (args[0] === "-n" || args[0] === "--steps") steps = Number(args[1] ?? "1") || 1;
  let current = await currentBranch();
  for (let step = 0; step < steps; step += 1) {
    const parentBranch = await parentOf(current);
    if (!parentBranch) {
      fail(`no parent below '${current}' (already at the base, or untracked)`);
    }
    current = parentBranch;
  }
  await git(["checkout", current]);
};

/** Move away from the trunk (to a child); prompts when a branch has several children. */
export const up = async (args: string[]): Promise<void> => {
  await inRepo();
  let steps = 1;
  let target = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-n" || arg === "--steps") steps = Number(args[(index += 1)] ?? "1") || 1;
    else if (arg === "--to") target = args[(index += 1)] ?? "";
    else fail(`unknown flag for up: ${arg}`);
  }
  let current = await currentBranch();
  for (let step = 0; step < steps; step += 1) {
    const kids = await childrenOf(current);
    if (kids.length === 0) fail(`no children above '${current}'`);
    if (kids.length > 1) {
      if (target && kids.includes(target)) {
        current = target;
      } else {
        logger.info(`multiple children above '${current}':`);
        for (const kid of kids) process.stdout.write(`  ${kid}\n`);
        fail("pick one: jabr checkout <branch>  (or jabr up --to <branch>)");
      }
    } else {
      current = kids[0] ?? current;
    }
  }
  await git(["checkout", current]);
};

/** Jump to the tip of the current stack. */
export const top = async (): Promise<void> => {
  await inRepo();
  let current = await currentBranch();
  for (;;) {
    const kids = await childrenOf(current);
    if (kids.length === 0) break;
    current = kids[0] ?? current;
  }
  await git(["checkout", current]);
};

/** Jump to the branch closest to the trunk (the stack root). */
export const bottom = async (): Promise<void> => {
  await inRepo();
  const root = await stackRoot(await currentBranch());
  if (!root) fail("current branch is not part of a stack");
  await git(["checkout", root]);
};

/** Rebase a branch and all its descendants onto their parents. */
export const restack = async (args: string[]): Promise<void> => {
  await inRepo();
  await requireClean();
  const current = await currentBranch();
  const start = args[0] ?? (await stackRoot(current));
  if (!start) fail("current branch is not part of a stack (nothing to restack)");
  await restackBranch(start);
  await gitTry(["checkout", "-q", current]);
  logger.success("restack complete");
};

/** Reparent the current branch onto a new target and restack its descendants. */
export const move = async (args: string[]): Promise<void> => {
  await inRepo();
  await requireClean();
  let onto = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-o" || arg === "--onto") onto = args[(index += 1)] ?? "";
    else fail(`unknown flag for move: ${arg}`);
  }
  if (!onto) fail("usage: jabr move --onto <target>");
  if (!(await branchExists(onto))) fail(`no such target branch: ${onto}`);
  const current = await currentBranch();
  if (onto === current) fail("cannot move a branch onto itself");
  await configSet(parentKey(current), onto);
  await restackBranch(current);
  await gitTry(["checkout", "-q", current]);
  logger.success(`moved '${current}' onto '${onto}' (descendants restacked)`);
};

/** Rename a branch and repair the parent metadata of its children. */
export const rename = async (args: string[]): Promise<void> => {
  await inRepo();
  let oldName = "";
  let newName = "";
  if (args.length >= 2) {
    oldName = args[0] ?? "";
    newName = args[1] ?? "";
  } else {
    oldName = await currentBranch();
    newName = args[0] ?? "";
  }
  if (!newName) fail("usage: jabr rename [old] <new>");
  if (!(await branchExists(oldName))) fail(`no such branch: ${oldName}`);
  if (await branchExists(newName)) fail(`branch '${newName}' already exists`);

  const parentBranch = await parentOf(oldName);
  const base = await baseOf(oldName);
  await git(["branch", "-m", oldName, newName]);
  if (parentBranch) {
    await configSet(parentKey(newName), parentBranch);
    if (base) await configSet(baseKey(newName), base);
    await configUnset(parentKey(oldName));
    await configUnset(baseKey(oldName));
  }
  for (const branch of await allBranches()) {
    if ((await parentOf(branch)) === oldName) await configSet(parentKey(branch), newName);
  }
  logger.success(`renamed '${oldName}' -> '${newName}'`);
};

/** Delete a branch and reparent its children onto the deleted branch's parent. */
export const deleteBranch = async (args: string[]): Promise<void> => {
  await inRepo();
  const name = args[0] ?? "";
  if (!name) fail("usage: jabr delete <branch>");
  if (!(await branchExists(name))) fail(`no such branch: ${name}`);

  let parentBranch = await parentOf(name);
  if (!parentBranch) parentBranch = await trunk();
  const tip = await git(["rev-parse", name]);
  for (const branch of await allBranches()) {
    if ((await parentOf(branch)) === name) {
      await configSet(parentKey(branch), parentBranch);
      await configSet(baseKey(branch), tip);
    }
  }
  if ((await currentBranch()) === name) await git(["checkout", "-q", parentBranch]);
  await git(["branch", "-D", name]);
  await configUnset(parentKey(name));
  await configUnset(baseKey(name));
  logger.success(
    `deleted '${name}'; children reparented onto '${parentBranch}' (run 'jabr restack' to realign)`,
  );
};

/** Collapse a branch's own commits into a single commit, then restack descendants. */
export const squash = async (args: string[]): Promise<void> => {
  await inRepo();
  await requireClean();
  let message = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-m" || arg === "--message") message = args[(index += 1)] ?? "";
    else fail(`unknown flag for squash: ${arg}`);
  }
  const current = await currentBranch();
  const parentBranch = await parentOf(current);
  if (!parentBranch) fail(`'${current}' is not a tracked branch`);
  const count = Number(await git(["rev-list", "--count", `${parentBranch}..${current}`]));
  if (count <= 0) fail(`'${current}' has no commits beyond '${parentBranch}'`);
  if (count === 1 && !message) {
    logger.info(`'${current}' already has a single commit`);
    return;
  }
  if (!message) message = await git(["log", "-1", "--format=%s", current]);
  await git(["reset", "-q", "--soft", parentBranch]);
  await git(["commit", "-q", "-m", message]);
  for (const child of await childrenOf(current)) await restackBranch(child);
  await gitTry(["checkout", "-q", current]);
  logger.success(`squashed '${current}' into one commit (descendants restacked)`);
};

/** Escape a literal string for safe inclusion in a `RegExp`. @internal */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the stack-navigation markdown block for one PR body. @internal */
const buildNav = (
  current: string,
  displayOrder: string[],
  numbers: Map<string, number | null>,
): string => {
  const lines = displayOrder.map((branch) => {
    const number = numbers.get(branch);
    const label = number == null ? "#?" : `#${number}`;
    return branch === current
      ? `- ${NAV_CURRENT_GLYPH} ${label} \`${branch}\` ${NAV_THIS_PR_ARROW} this PR`
      : `- ${label} \`${branch}\``;
  });
  return [
    NAV_BEGIN,
    `**${NAV_HEADING_GLYPH} Stack** — managed by [\`jabr\`](https://github.com/ahmadatallah/jabr)`,
    "",
    ...lines,
    NAV_END,
  ].join("\n");
};

/** Replace (or append) the stack-navigation block within an existing PR body. @internal */
const spliceNav = (body: string, nav: string): string => {
  const pattern = new RegExp(`${escapeRegExp(NAV_BEGIN)}[\\s\\S]*?${escapeRegExp(NAV_END)}`);
  if (pattern.test(body)) return body.replace(pattern, nav);
  return `${body.trimEnd()}\n\n${nav}`.trimStart();
};

/**
 * Push branches and create/update a pull request for each, wiring every PR's
 * base to its parent branch and refreshing the stack-navigation block.
 *
 * By default operates on the lineage from the stack root up to the current
 * branch; `--stack`/`-s` operates on the entire stack (root and all descendants).
 */
export const submit = async (args: string[]): Promise<void> => {
  await inRepo();
  needGitHubCli();
  if (!(await hasOrigin())) fail("no 'origin' remote configured");

  let draft = false;
  let push = true;
  let whole = false;
  for (const arg of args) {
    if (arg === "--draft") draft = true;
    else if (arg === "--no-push") push = false;
    else if (arg === "-s" || arg === "--stack") whole = true;
    else fail(`unknown flag for submit: ${arg}`);
  }

  const current = await currentBranch();
  const root = await stackRoot(current);
  if (!root) fail("current branch is not part of a stack");
  const targets = whole ? await walk(root) : (await ancestors(current)).reverse();

  // Pass 1: push each branch (root-first) and ensure a PR exists with the right base.
  for (const branch of targets) {
    const parentBranch = await parentOf(branch);
    if (push) {
      logger.start(`pushing '${branch}'`);
      const pushed = await gitTry(["push", "--force-with-lease", "-u", "origin", branch]);
      if (pushed.code !== 0) {
        process.stderr.write(pushed.stderr);
        fail(`failed to push '${branch}'`);
      }
    }
    const prExists = (await ghTry(["pr", "view", branch, "--json", "number"])).code === 0;
    if (prExists) {
      await gh(["pr", "edit", branch, "--base", parentBranch]);
      logger.success(`updated PR for '${branch}' (base: ${parentBranch})`);
    } else {
      const createArgs = ["pr", "create", "--head", branch, "--base", parentBranch, "--fill"];
      if (draft) createArgs.push("--draft");
      await gh(createArgs);
      logger.success(`opened PR for '${branch}' (base: ${parentBranch})`);
    }
  }

  // Pass 2: collect PR numbers and refresh the navigation block on every PR.
  const numbers = new Map<string, number | null>();
  for (const branch of targets) {
    const viewed = await ghTry(["pr", "view", branch, "--json", "number"]);
    numbers.set(branch, viewed.code === 0 ? (JSON.parse(viewed.stdout).number as number) : null);
  }
  const displayOrder = [...targets].reverse();
  for (const branch of targets) {
    const viewed = await ghTry(["pr", "view", branch, "--json", "body"]);
    const existingBody = viewed.code === 0 ? ((JSON.parse(viewed.stdout).body as string) ?? "") : "";
    const updatedBody = spliceNav(existingBody, buildNav(branch, displayOrder, numbers));
    await gh(["pr", "edit", branch, "--body", updatedBody]);
  }
  logger.success("stack navigation updated on all PRs");
};

/**
 * Fetch, fast-forward the trunk, detect merged PRs, and restack what remains.
 *
 * Merged branches are only deleted when `--delete`/`-d` is passed; otherwise they
 * are reported. Deletion reparents their children onto the trunk and records the
 * merged tip as the base so the following restack drops the now-merged commits.
 */
export const sync = async (args: string[]): Promise<void> => {
  await inRepo();
  await requireClean();
  const deleteMerged = args[0] === "-d" || args[0] === "--delete";
  const trunkBranch = await trunk();
  let current = await currentBranch();

  if (await hasOrigin()) {
    logger.start("fetching origin");
    await git(["fetch", "--prune", "origin"]);
    logger.start(`fast-forwarding '${trunkBranch}'`);
    await git(["checkout", "-q", trunkBranch]);
    const merged = await gitTry(["merge", "--ff-only", `origin/${trunkBranch}`]);
    if (merged.code !== 0) {
      await gitTry(["checkout", "-q", current]);
      fail(`'${trunkBranch}' has diverged from 'origin/${trunkBranch}'; reconcile manually then re-run sync`);
    }
    await gitTry(["checkout", "-q", current]);
  } else {
    logger.info("no 'origin' remote; skipping fetch");
  }

  const mergedBranches: string[] = [];
  if (Bun.which("gh") && (await hasOrigin())) {
    for (const branch of await allBranches()) {
      if (!(await isTracked(branch))) continue;
      const state = await ghTry(["pr", "view", branch, "--json", "state"]);
      if (state.code === 0 && JSON.parse(state.stdout).state === "MERGED") {
        mergedBranches.push(branch);
      }
    }
  }

  if (mergedBranches.length > 0) {
    if (deleteMerged) {
      for (const branch of mergedBranches) {
        const tip = await git(["rev-parse", branch]);
        for (const candidate of await allBranches()) {
          if ((await parentOf(candidate)) === branch) {
            await configSet(parentKey(candidate), trunkBranch);
            await configSet(baseKey(candidate), tip);
          }
        }
        if (current === branch) {
          await git(["checkout", "-q", trunkBranch]);
          current = trunkBranch;
        }
        await git(["branch", "-D", branch]);
        await configUnset(parentKey(branch));
        await configUnset(baseKey(branch));
        logger.success(`deleted merged branch '${branch}'`);
      }
    } else {
      logger.info(`merged PRs detected for: ${mergedBranches.join(", ")}`);
      logger.info("run 'jabr sync --delete' to remove them, reparent children, and restack");
    }
  }

  for (const branch of (await allBranches()).sort()) {
    if ((await parentOf(branch)) === trunkBranch) await restackBranch(branch);
  }
  await gitTry(["checkout", "-q", current]);
  logger.success("sync complete");
};
