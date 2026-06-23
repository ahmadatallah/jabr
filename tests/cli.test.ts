/**
 * Coverage for the CLI entry point (`scripts/jabr.ts`): argument dispatch for
 * every command + alias, help/version output, and the top-level error handler.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";

import { main, run, VERSION } from "../scripts/jabr";
import * as commands from "../scripts/lib/commands";
import { captureStdout, cleanupRepos, expectExit, makeRepo } from "./helpers";

/** Invoke the dispatcher with the given argv tail, capturing stdout. */
const cli = (args: string[]): Promise<string> => {
  process.argv = ["bun", "jabr", ...args];
  return captureStdout(() => main());
};

beforeEach(async () => {
  await makeRepo();
  await commands.init([]);
});

afterAll(async () => {
  await cleanupRepos();
});

test("help and no-command print usage", async () => {
  expect(await cli(["help"])).toContain(`jabr ${VERSION}`);
  expect(await cli(["-h"])).toContain("USAGE");
  expect(await cli(["--help"])).toContain("USAGE");
  expect(await cli([])).toContain("USAGE");
});

test("version flags print the version", async () => {
  expect(await cli(["version"])).toBe(`jabr ${VERSION}\n`);
  expect(await cli(["-v"])).toBe(`jabr ${VERSION}\n`);
  expect(await cli(["--version"])).toBe(`jabr ${VERSION}\n`);
});

test("unknown commands exit non-zero", async () => {
  process.argv = ["bun", "jabr", "frobnicate"];
  await expectExit(() => main());
});

test("run() reports an error from main and exits non-zero", async () => {
  process.argv = ["bun", "jabr", "frobnicate"];
  await expectExit(() => run());
});

test("every command and alias is dispatched", async () => {
  // Each entry is run against a fresh repo; we only need the switch arm to fire,
  // so handlers that go on to fail (missing args, no remote) are tolerated.
  const invocations: string[][] = [
    ["init"],
    ["create", "feat", "-a", "-m", "x"],
    ["modify"],
    ["track"],
    ["untrack"],
    ["squash"],
    ["move", "--onto", "main"],
    ["rename", "renamed"],
    ["delete", "feat"],
    ["rm", "feat"],
    ["parent"],
    ["children"],
    ["trunk"],
    ["log"],
    ["ls"],
    ["status"],
    ["checkout", "main"],
    ["co", "main"],
    ["up"],
    ["down"],
    ["top"],
    ["bottom"],
    ["restack"],
    ["submit"],
    ["sync"],
  ];

  for (const args of invocations) {
    await makeRepo();
    await commands.init([]);
    if (["modify", "squash", "rename", "delete", "rm", "move"].includes(args[0]!)) {
      // Give these something to operate on.
      await Bun.write("f.txt", "f\n");
      await commands.create(["feat", "-a", "-m", "feat"]);
    }
    process.argv = ["bun", "jabr", ...args];
    try {
      await captureStdout(() => main());
    } catch {
      // a fail() inside the handler is fine — the dispatch line still ran.
    }
  }
}, 30_000);
