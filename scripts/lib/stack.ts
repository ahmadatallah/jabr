/**
 * The stack model: metadata storage (in local git config), the parent/child
 * branch graph, and the restack algorithm that keeps descendants rebased onto
 * their parents.
 *
 * A "stack" is a chain (or tree) of branches rooted at the trunk. Each tracked
 * branch records two pieces of metadata in git config:
 *
 * - `branch.<name>.jabrParent` — the branch it is stacked on
 * - `branch.<name>.jabrBase` — the parent tip SHA it was last based on
 *
 * The stored base is what makes restacking exact: `git rebase --onto
 * <new-parent-tip> <stored-base> <branch>` replays only the branch's own commits
 * onto the moved parent, never duplicating the parent's commits.
 *
 * @packageDocumentation
 */

import { allBranches, branchExists, git, gitTry } from "./git";
import { fail, logger } from "./logger";

/** git-config key holding a branch's parent in the stack. */
export const parentKey = (branch: string): string => `branch.${branch}.jabrParent`;

/** git-config key holding the parent tip SHA a branch was last based on. */
export const baseKey = (branch: string): string => `branch.${branch}.jabrBase`;

/** git-config key holding the configured trunk branch. */
export const TRUNK_KEY = "jabr.trunk";

/**
 * Read a local git-config value.
 *
 * @param key - Fully-qualified config key.
 * @returns The trimmed value, or an empty string when unset.
 */
export const configGet = async (key: string): Promise<string> => {
  const result = await gitTry(["config", "--local", "--get", key]);
  return result.code === 0 ? result.stdout.trim() : "";
};

/** Write a local git-config value. */
export const configSet = async (key: string, value: string): Promise<void> => {
  await git(["config", "--local", key, value]);
};

/** Remove a local git-config value (no-op if already unset). */
export const configUnset = async (key: string): Promise<void> => {
  await gitTry(["config", "--local", "--unset", key]);
};

/** The recorded parent of a branch, or an empty string if untracked. */
export const parentOf = (branch: string): Promise<string> => configGet(parentKey(branch));

/** The recorded base SHA of a branch, or an empty string if unset. */
export const baseOf = (branch: string): Promise<string> => configGet(baseKey(branch));

/** Whether a branch is part of a jabr stack (has a recorded parent). */
export const isTracked = async (branch: string): Promise<boolean> =>
  (await parentOf(branch)) !== "";

/**
 * Best-effort detection of the repository's trunk branch.
 *
 * Prefers a local `main`, `master`, or `trunk`; otherwise falls back to the
 * branch `origin/HEAD` points at.
 *
 * @returns The detected trunk name, or an empty string if none could be found.
 */
export const detectTrunk = async (): Promise<string> => {
  for (const candidate of ["main", "master", "trunk"]) {
    if (await branchExists(candidate)) return candidate;
  }
  const result = await gitTry([
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  return result.code === 0 ? result.stdout.trim().replace(/^origin\//, "") : "";
};

/**
 * The configured trunk branch, falling back to {@link detectTrunk}.
 *
 * @throws Exits via {@link fail} when no trunk can be determined.
 */
export const trunk = async (): Promise<string> => {
  let configured = await configGet(TRUNK_KEY);
  if (!configured) configured = await detectTrunk();
  if (!configured) fail("cannot determine trunk; run: jabr init <trunk-branch>");
  return configured;
};

/**
 * The direct children of a branch (branches whose parent is `parent`).
 *
 * @param parent - The branch whose children to list.
 * @returns Child branch names, sorted alphabetically.
 */
export const childrenOf = async (parent: string): Promise<string[]> => {
  const children: string[] = [];
  for (const branch of await allBranches()) {
    if ((await parentOf(branch)) === parent) children.push(branch);
  }
  return children.sort();
};

/**
 * The chain of tracked ancestors from a branch up to (but excluding) the trunk.
 *
 * @param branch - The starting branch.
 * @returns Ancestors nearest-first (the branch itself, then its parent, …).
 */
export const ancestors = async (branch: string): Promise<string[]> => {
  const trunkBranch = await trunk();
  const chain: string[] = [];
  let current = branch;
  while (current && current !== trunkBranch) {
    chain.push(current);
    current = await parentOf(current);
  }
  return chain;
};

/**
 * The root of the stack containing `branch` — the ancestor whose parent is the
 * trunk.
 *
 * @param branch - Any branch in the stack.
 * @returns The stack root, or an empty string if the branch is untracked.
 */
export const stackRoot = async (branch: string): Promise<string> => {
  const trunkBranch = await trunk();
  let current = branch;
  while (current && current !== trunkBranch) {
    const parent = await parentOf(current);
    if (parent === trunkBranch) return current;
    if (!parent) return "";
    current = parent;
  }
  return "";
};

/**
 * Depth-first traversal of the subtree rooted at `node`, root first.
 *
 * @param node - The subtree root.
 * @returns Branch names in root-first (parents-before-children) order.
 */
export const walk = async (node: string): Promise<string[]> => {
  const ordered = [node];
  for (const child of await childrenOf(node)) {
    ordered.push(...(await walk(child)));
  }
  return ordered;
};

/**
 * Rebase a branch onto its parent's current tip, then recurse into its children.
 *
 * Uses the stored {@link baseKey | base SHA} as the `--onto` upstream so only the
 * branch's own commits are replayed. The base is refreshed after a successful
 * rebase. On conflict, the original git output is surfaced and the process exits
 * with recovery instructions.
 *
 * @param branch - The branch to restack (its descendants are restacked too).
 */
export const restackBranch = async (branch: string): Promise<void> => {
  const parent = await parentOf(branch);
  if (!parent) return;
  if (!(await branchExists(parent))) {
    fail(
      `parent '${parent}' of '${branch}' no longer exists; ` +
        `fix with 'jabr track ${branch} --parent <name>'`,
    );
  }

  const newBase = await git(["rev-parse", parent]);
  let oldBase = await baseOf(branch);
  if (!oldBase) oldBase = await git(["merge-base", parent, branch]);

  if (oldBase !== newBase) {
    logger.start(`restacking '${branch}' onto '${parent}'`);
    await git(["checkout", "-q", branch]);
    const rebase = await gitTry(["rebase", "--onto", newBase, oldBase, branch]);
    if (rebase.code !== 0) {
      process.stderr.write(rebase.stdout + rebase.stderr);
      fail(
        `rebase conflict while restacking '${branch}'.\n` +
          `  Resolve the conflicts, run 'git rebase --continue' (or '--abort'), ` +
          `then re-run 'jabr restack'.`,
      );
    }
  }

  await configSet(baseKey(branch), newBase);
  for (const child of await childrenOf(branch)) {
    await restackBranch(child);
  }
};
