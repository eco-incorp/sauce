/**
 * A pool's slot read from its own state (`svm/pool-slot.ts`), for each price-limit venue's pool as
 * mainnet held it (`venue-fixture.ts`): the nine accounts, paying either token, are the fixture's
 * own — the slot the distributed swap's suites run on these pools.
 */
import { address, type Address } from "@solana/kit";

import { requireChain } from "../../src/chains/canonical.js";
import {
  isSvmAccountName,
  resolveSvmAccountName,
  type SvmAccountNameContext,
} from "../../src/svm/account-names.js";
import { SVM_SLOT_PARTS, svmPoolSlot, svmSlotAccounts } from "../../src/svm/pool-slot.js";
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

describe("slot:<pool>:<token>.<part>, the account-name form", () => {
  const SOLANA = requireChain("solana");
  const ctx = (more: Partial<SvmAccountNameContext> = {}): SvmAccountNameContext => ({
    chain: SOLANA,
    owner: address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"),
    pot: address("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"),
    load,
    ...more,
  });

  it("names each of a pool's nine accounts paying a token, the pool a key or main's argument", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    const ticks = key(USDC) < key(WSOL) ? p.payA : p.payB; // paying USDC
    const expected = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra, ...ticks];
    for (const [index, part] of SVM_SLOT_PARTS.entries()) {
      expect(await resolveSvmAccountName(`slot:${p.pool}:USDC.${part}`, ctx())).toEqual({
        value: expected[index],
        label: `pool ${p.pool}'s ${part}, paying USDC`,
        kind: "address",
      });
    }
    expect(
      (await resolveSvmAccountName("slot:@pool:WSOL.ticks0", ctx({ args: { pool: p.pool } })))
        .value,
    ).toBe((key(WSOL) < key(USDC) ? p.payA : p.payB)[0]);
  });

  it("refuses with no loader, and a pool whose slot cannot be read", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    await expect(
      resolveSvmAccountName(`slot:${p.pool}:USDC.vaultA`, ctx({ load: undefined })),
    ).rejects.toThrow("slot is read from the cluster, which this resolution has no way to do");
    await expect(resolveSvmAccountName(`slot:${p.pool}:USDT.vaultA`, ctx())).rejects.toThrow(
      `pool ${p.pool}'s slot paying USDT could not be read: Orca Whirlpools pool`,
    );
    expect(isSvmAccountName(`slot:${p.pool}:USDC.vault`)).toBe(false);
  });
});
