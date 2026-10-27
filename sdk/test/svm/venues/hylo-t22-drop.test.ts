/**
 * hylo Token-2022 self-drop: this leg's two mints are protocol constants
 * (USDC / hyUSD). If either resolves to a Token-2022 (or un-routable) mint the
 * singleton pair must drop (fetchPoolConfig throws) rather than assuming legacy.
 * The mint is classified by its OWNER: an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  hylo,
  HYUSD_MINT,
  USDC_MINT,
  USDC_PAIR_ACCOUNT,
} from "../../../src/svm/venues/hylo/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

function loaderOf(entries: Array<[Address, Uint8Array, Address]>): OwnedAccountLoader {
  const map = new Map(entries.map(([a, data, owner]) => [a as string, { data, owner }]));
  return async (addr) => {
    const account = map.get(addr as string);
    return account === undefined
      ? null
      : { data: new Uint8Array(account.data), owner: account.owner };
  };
}

describe("hylo Token-2022 self-drop", () => {
  it("drops when the USDC mint resolves to a Token-2022 mint", async () => {
    const load = loaderOf([[USDC_MINT, makeT22Mint(), TOKEN_2022_PROGRAM_ID]]);
    await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.toThrow(/Token-2022/);
  });

  it("drops when the USDC mint is 82 bytes but owned by Token-2022 (extensionless)", async () => {
    const load = loaderOf([[USDC_MINT, makeLegacyMint(), TOKEN_2022_PROGRAM_ID]]);
    await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.toThrow(/Token-2022/);
  });

  it("drops when the hyUSD mint carries an un-routable extension", async () => {
    const load = loaderOf([[HYUSD_MINT, makeT22Mint(NON_TRANSFERABLE_TLV), TOKEN_2022_PROGRAM_ID]]);
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

  it("refuses when a mint is 82 bytes but owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [USDC_MINT, HYUSD_MINT]) {
      const load = loaderOf([[mint, makeLegacyMint(), foreign]]);
      await expect(hylo.fetchPoolConfig(load, USDC_PAIR_ACCOUNT)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
