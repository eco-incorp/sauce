/**
 * A pool's slot read from its own state (`svm/pool-slot.ts`), for each price-limit venue's pool as
 * mainnet held it (`venue-fixture.ts`): the nine accounts, paying either token, are the fixture's
 * own — the slot the distributed swap's suites run on these pools.
 */
import { address, type Address } from "@solana/kit";

import { svmPoolSlot, svmSlotAccounts } from "../../src/svm/pool-slot.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import { BYTES, SNAPSHOT, pool, USDC, USDT, WSOL, key } from "./venue-fixture.js";

/** The fixture's accounts, as an owner-aware loader reads them. */
const load: OwnedAccountLoader = async (at) => {
  const data = BYTES.get(at);
  return data === undefined ? null : { data, owner: SNAPSHOT.get(at)!.owner };
};

describe("svmPoolSlot", () => {
  // Byreal is left out: byreal-sol-usdc's fixture slot is the System program throughout (its fees
  // are more than one rate, so the distributed swap skips it and its accounts were never dumped), and
  // byreal-usdc's tick arrays past the first were chosen by the dump from a scan of the arrays that
  // exist, where the slot reader takes them from the pool's bitmap, as `sauce pools` always has.
  it.each([
    ["raydium-clmm-sol-usdc", WSOL, USDC],
    ["pancakeswap-clmm-sol-usdc", WSOL, USDC],
    ["stabble-clmm-usdc-usdt", USDC, USDT],
    ["orca-whirlpool-sol-usdc", WSOL, USDC],
    ["cropper-sol-usdc", WSOL, USDC],
    ["defituna-sol-usdc", WSOL, USDC],
    ["crema-sol-usdc", WSOL, USDC],
    ["phoenix-sol-usdc", WSOL, USDC],
  ] as const)("%s: the slot paying either token is the fixture's", async (name, a, b) => {
    const p = pool(name);
    // The lower-key token pays toward the falling price.
    const [lower, higher] = key(a) < key(b) ? [a, b] : [b, a];
    for (const [pay, ticks] of [
      [lower, p.payA],
      [higher, p.payB],
    ] as const) {
      const slot = await svmPoolSlot(load, p.pool, pay);
      expect(svmSlotAccounts(slot)).toEqual([
        p.program,
        p.pool,
        p.config,
        p.vaultA,
        p.vaultB,
        p.extra,
        ...ticks,
      ]);
    }
  });

  it("refuses a pool no price-limit venue owns, and a token its pair does not hold", async () => {
    const usdcUsdt = pool("stabble-clmm-usdc-usdt");
    await expect(svmPoolSlot(load, usdcUsdt.pool, WSOL)).rejects.toThrow(
      `Stabble CLMM pool ${usdcUsdt.pool} trades`,
    );
    const dlmm = pool("meteora-dlmm-sol-usdc");
    await expect(svmPoolSlot(load, dlmm.pool, USDC)).rejects.toThrow(
      "which is not a venue whose swap stops at a price limit",
    );
    const nowhere = address("11111111111111111111111111111112") as Address;
    await expect(svmPoolSlot(load, nowhere, USDC)).rejects.toThrow("has no account");
  });
});
