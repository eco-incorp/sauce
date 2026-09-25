/**
 * hylo Token-2022 self-drop: this leg's two mints are protocol constants
 * (USDC / hyUSD). If either resolves to a Token-2022 (or un-routable) mint the
 * singleton pair must drop (fetchPoolConfig throws) rather than assuming legacy.
 */
import type { Address } from "@solana/kit";
import {
  hylo,
  HYUSD_MINT,
  USDC_MINT,
  USDC_PAIR_ACCOUNT,
} from "../../../src/svm/venues/hylo/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (addr) => {
    const d = map.get(addr as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

describe("hylo Token-2022 self-drop", () => {
  it("drops when the USDC mint resolves to a Token-2022 mint", async () => {
    const load = loaderOf([[USDC_MINT, makeT22Mint()]]);
    await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.toThrow(/Token-2022/);
  });

  it("drops when the hyUSD mint carries an un-routable extension", async () => {
    const load = loaderOf([[HYUSD_MINT, makeT22Mint(NON_TRANSFERABLE_TLV)]]);
    await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.toThrow(
      /Token-2022|un-routable/,
    );
  });

  it("does NOT drop when both mints are unreadable (legacy assumption)", async () => {
    // No mint accounts vendored → continue → the fetch proceeds and fails later
    // on the missing Hylo/pair accounts, proving the T22 guard did not fire.
    const load = loaderOf([]);
    await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.not.toThrow(
      /Token-2022|un-routable/,
    );
  });
});
