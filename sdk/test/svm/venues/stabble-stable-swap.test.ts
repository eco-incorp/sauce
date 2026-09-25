/**
 * stabble-stable-swap Account-model migration unit (RS/WASM compile, no engine):
 * emitQuote now reads the pool's two balances + swap fee through the Account
 * model — `svm.sload(acc0, off, 8).toLe()` over main()'s single positional
 * `acc0` param — instead of the TS compiler's `accountUint("<ref>", off, 8)`
 * sugar, and its amp-ramp gate uses `ctx.timestamp()` (was `block.timestamp`).
 *
 * The N-token Newton quote helper is the crux of this migration: the RS compiler
 * forbids a nested function inside main(), so — unlike the old TS path, which
 * inlined the helper into the fragment — it is now a TOP-LEVEL function the
 * caller declares from `stableQuoteHelperSource(n)` (renamed `<name>_<i>`),
 * with main() calling it. That helper's Newton loops use `iter++`, so this
 * compile VALIDATES #385 (++/-- update expressions) end to end on a real venue
 * program, and the top-level-helper + main shape is the hoist itself.
 *
 * Real mainnet snapshot: pool 5K7CHUbBYAh6wrantyJvDDqwT4VoKuZTi73CN1DTUUer,
 * test/svm/fixtures/stabble-stable-swap/{pool,vault}.json.
 */
import { resolve } from "path";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { stabbleStableSwap } from "../../../src/svm/venues/stabble-stable-swap/index.js";
import type { StabbleStableSwapPoolConfig } from "../../../src/svm/venues/stabble-stable-swap/index.js";
import {
  stableQuoteHelperSource,
  STABLE_SWAP_PROGRAM_ID,
} from "../../../src/svm/venues/stabble-common.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/stabble-stable-swap"));
const POOL_ADDRESS = FIXTURES.find((f) => f.owner === STABLE_SWAP_PROGRAM_ID)!.address;

/** The top-level Newton helper this fragment calls: stableQuoteHelperSource(n) renamed per pool index i. */
function topLevelHelper(n: number, i: number): string {
  const helper = stableQuoteHelperSource(n);
  return helper.source.replace(helper.name, `${helper.name}_${i}`);
}

let cfg: StabbleStableSwapPoolConfig;
beforeAll(async () => {
  cfg = (await stabbleStableSwap.fetchPoolConfig(
    fixtureLoader(FIXTURES),
    POOL_ADDRESS as never,
  )) as StabbleStableSwapPoolConfig;
});

describe("stabble-stable-swap emitQuote — Account model (svm.sload) via RS", () => {
  it("reads the two balances and swap fee through main()'s acc0 param, never accountUint/block.timestamp", () => {
    const fragment = stabbleStableSwap.emitQuote(cfg, 0, 1_000_000n);
    expect(fragment).toContain("const bal0_0 = svm.sload(acc0, ");
    expect(fragment).toContain("const bal1_0 = svm.sload(acc0, ");
    expect(fragment).toContain("const fee0 = svm.sload(acc0, ");
    expect(fragment).toContain(".toLe();");
    expect(fragment).not.toContain("accountUint(");
    expect(fragment).not.toContain("block.timestamp");
    // The helper is NO LONGER inlined into the fragment — only CALLED.
    expect(fragment).not.toContain("function stabbleStableQuoteN");
    expect(fragment).toContain("const rawOut0 = stabbleStableQuoteN2_0(amp0, bal0_0, bal1_0,");
  });

  it("compiles for the svm target with the hoisted top-level Newton helper (validates #385 iter++ and the hoist)", () => {
    const n = cfg.tokens.length;
    const helper = topLevelHelper(n, 0);
    // The helper's Newton loops use ++ (the #385 fix) — proven by compiling it.
    expect(helper).toContain("iter++");
    const fragment = stabbleStableSwap.emitQuote(cfg, 0, 1_000_000n);
    const accounts = stabbleStableSwap.quoteAccounts(cfg); // ordered [pool]
    const source = `${helper}\n${wrapQuoteMain(accounts.length, fragment, "q0")}`;
    const { bytecode, manifest } = compileSvm(source);
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual(
      accounts.map((_, i) => ({ kind: "slot", index: i, name: `acc${i}`, requires: "readonly" })),
    );
    const boundAddresses = manifest?.accounts.map((meta) =>
      meta.kind === "slot" ? accounts[meta.index]?.address : undefined,
    );
    expect(boundAddresses).toEqual([POOL_ADDRESS]);
  });
});
