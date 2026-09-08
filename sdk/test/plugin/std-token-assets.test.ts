/**
 * The `@sauce/token` payload that actually gets PUBLISHED.
 *
 * `src/std/token` is SauceScript plus its ABI — files `tsc` does not emit — so
 * `copy-verify-assets.mjs` copies them into `dist/std/token` from a HAND-ENUMERATED list, and
 * `dist/` is what a consumer installs. That enumeration is the hazard: add a file to
 * `src/std/token` and forget the entry, and every published consumer's `openRoute` throws
 * `failed to import module "@sauce/token"` — while CI stays green, because the in-repo suites
 * resolve `src/std` and never read `dist/` at all.
 *
 * So this runs the real copy and compares the two DIRECTORIES. Comparing the list against `dist/`
 * alone would only prove the copy ran; a file missing from the list is missing from `dist/` too,
 * and only the source directory knows it should have been there.
 *
 * The script is exec'd rather than imported, for the reason `routes-globals-drift.test.ts` gives
 * about its own: jest's transform here matches `.ts`/`.js`, so a `.mjs` is not importable under
 * this config. It only copies files (no Foundry, no engine, no network), so running it is cheap and
 * self-contained.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SDK_DIR = resolve(process.cwd());
const SCRIPT_PATH = resolve(SDK_DIR, "scripts", "copy-verify-assets.mjs");
const STD_TOKEN = join("std", "token");

const listing = (root: string): string[] => readdirSync(resolve(SDK_DIR, root, STD_TOKEN)).sort();

describe("@sauce/token: the published dist/std/token payload", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [SCRIPT_PATH], { cwd: SDK_DIR, encoding: "utf8" });
  });

  it("copies EVERY file in src/std/token — one added there must be added to the copy list", () => {
    expect(listing("dist")).toEqual(listing("src"));
  });

  it("carries both engine arms and the ABI — the module is unusable on one target without them", () => {
    // Spelled out as well as compared, so deleting a source file (which the equality above would
    // happily accept, both sides shrinking together) still fails here.
    expect(listing("dist")).toEqual(expect.arrayContaining(["erc20.abi.json", "package.json", "token.evm.js", "token.svm.js"]));
  });
});
