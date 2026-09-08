/**
 * stabble-weighted-swap Account-model migration unit (RS/WASM compile, no engine):
 * the emitQuote fragment now reads its on-chain pool fields through the Account
 * model — `svm.sload(acc0, off, 8).toLe()` over main()'s positional `acc<k>`
 * params — instead of the TS compiler's `accountUint("<ref>", off, 8)` string-ref
 * sugar. quoteAccounts() attaches the pool alone, so it is slot 0 (acc0); the
 * emitted manifest binds slot 0 back to that pool address.
 *
 * Real mainnet snapshot: pool JV4MkRFn58xpyrhF2oDxQYwnq5jFVzTQUKcUzce1FQA
 * (wSOL/... weighted pool), test/svm/fixtures/stabble-weighted-swap/*.json.
 */
import { resolve } from "path";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { stabbleWeightedSwap } from "../../../src/svm/venues/stabble-weighted-swap/index.js";
import type { StabbleWeightedSwapPoolConfig } from "../../../src/svm/venues/stabble-weighted-swap/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/stabble-weighted-swap"));
const POOL_ADDRESS = FIXTURES.find(
  (f) => f.owner === "swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW",
)!.address;

let cfg: StabbleWeightedSwapPoolConfig;
beforeAll(async () => {
  cfg = (await stabbleWeightedSwap.fetchPoolConfig(
    fixtureLoader(FIXTURES),
    POOL_ADDRESS as never,
  )) as StabbleWeightedSwapPoolConfig;
});

describe("stabble-weighted-swap emitQuote — Account model (svm.sload) via RS", () => {
  it("reads the pool balances and fee through main()'s acc0 param", () => {
    const fragment = stabbleWeightedSwap.emitQuote(cfg, 0, 1_000_000_000n);
    // pool is quoteAccounts() slot 0 -> acc0; every read is u64 LE -> .toLe().
    expect(fragment).toContain("svm.sload(acc0, ");
    expect(fragment).toContain(".toLe();");
    expect(fragment).not.toContain("accountUint(");
  });

  it("compiles for the svm target and manifests the pool in quoteAccounts order", () => {
    const fragment = stabbleWeightedSwap.emitQuote(cfg, 0, 1_000_000_000n);
    const accounts = stabbleWeightedSwap.quoteAccounts(cfg); // ordered [pool]
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, "q0"));
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
