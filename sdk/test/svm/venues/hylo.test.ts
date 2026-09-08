/**
 * Hylo adapter emitQuote units (no engine): the Account-model migration —
 * `accountUint("<ref>", …)` string refs replaced by `svm.sload(acc<k>, …).toLe()`
 * reads through main()'s ordered `Account` params (k = the ref's index in
 * quoteAccounts, which for hylo is [pair=acc0, pyth=acc1, vault=acc2]) — and the
 * RS/svm compile that produces the account manifest in that param order.
 *
 * Hylo has no dedicated venue fixture test (only the barrel-surface export
 * check), so this is a minimal compile+manifest test following pumpswap.test.ts's
 * shape, added by the Account-model migration.
 */
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import { hylo } from "../../../src/svm/venues/hylo/index.js";
import type { PoolConfig } from "../../../src/svm/venues/types.js";

// emitQuote consults only `venue`, `direction` and `priceScale`; the remaining
// HyloPoolConfig fields are prepare-time gate snapshots the fragment never reads.
const baseCfg = {
  venue: "hylo",
  pool: "HYLO_USDC_PAIR",
  priceScale: 1000n,
  protocolPausedAtFetch: false,
  pairPausedAtFetch: false,
  verificationTagAtFetch: 0,
  priceRawAtFetch: 0n,
  confRawAtFetch: 0n,
  publishTimeAtFetch: 0n,
  intervalSecsAtFetch: 0n,
  confToleranceBitsAtFetch: 0n,
} as unknown as PoolConfig;

const mintCfg = { ...(baseCfg as object), direction: "aToB" } as unknown as PoolConfig;
const redeemCfg = { ...(baseCfg as object), direction: "bToA" } as unknown as PoolConfig;

describe("hylo adapter identity", () => {
  it("identifies itself", () => {
    expect(hylo.slug).toBe("hylo");
  });
});

describe("hylo quoteAccounts", () => {
  it("attaches the pair, pyth and vault refs in order", () => {
    expect(hylo.quoteAccounts(mintCfg).map((account) => account.ref)).toEqual([
      "hylo:pair",
      "hylo:pyth",
      "hylo:vault",
    ]);
  });
});

describe("hylo emitQuote (Account model)", () => {
  it("mint (aToB) reads pair (acc0) and pyth (acc1) via svm.sload().toLe()", () => {
    const fragment = hylo.emitQuote(mintCfg, 0, 1_000_000n);
    expect(fragment).not.toContain("accountUint(");
    expect(fragment).toContain("const h0fee = svm.sload(acc0,");
    expect(fragment).toContain("const h0price = svm.sload(acc1,");
    expect(fragment).toContain("const h0conf = svm.sload(acc1,");
    // aToB never reads the collateral vault (acc2).
    expect(fragment).not.toContain("acc2");
  });

  it("redeem (bToA) also reads the virtual supply on pair (acc0) and the vault (acc2)", () => {
    const fragment = hylo.emitQuote(redeemCfg, 0, 1_000_000n);
    expect(fragment).not.toContain("accountUint(");
    expect(fragment).toContain("const h0vsupply = svm.sload(acc0,");
    expect(fragment).toContain("const h0vault = svm.sload(acc2,");
  });

  it("compiles for the svm target, manifesting the quote accounts in param order (both directions)", () => {
    for (const cfg of [mintCfg, redeemCfg]) {
      const accounts = hylo.quoteAccounts(cfg);
      const { bytecode, manifest } = compileSvm(
        wrapQuoteMain(accounts.length, hylo.emitQuote(cfg, 0, 1_000_000n), "q0"),
      );
      expect(bytecode.length).toBeGreaterThan(0);
      expect(manifest?.accounts).toEqual(
        accounts.map((_, k) => ({ kind: "slot", index: k, name: "acc" + k, requires: "readonly" })),
      );
    }
  });
});
