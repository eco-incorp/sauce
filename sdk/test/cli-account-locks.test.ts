/**
 * The cook's account-lock check (`cli/solana.ts#refuseTooManyAccounts`): the accounts a cook
 * attaches and its own around them, each counted once by its address, held to the 64 a Solana
 * transaction may lock, and refused past them naming the pool each key found.
 */
import { getAddressCodec, type Address } from "@solana/kit";

import { ACCOUNT_LOCK_LIMIT, refuseTooManyAccounts } from "../src/cli/solana.js";

const key = (n: number): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, n + 1);
  return getAddressCodec().decode(bytes);
};
const OWNER = key(1_000);
const POT = key(1_001);
const FEE_CONFIG = key(1_002);
/** The cook's own: the owner, the Pot, the Kitchen, the engine, the fee's config, the System and
 *  compute-budget programs, and a staged program's two buffers. */
const OWN = 9;

/** `n` distinct accounts, and the cook's own named again, which count once. */
const attaching = (n: number): Record<string, string> => ({
  ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, key(i)])),
  pot: "pot",
  owner: "owner",
  fee: FEE_CONFIG,
  system: "11111111111111111111111111111111",
});

describe("the cook's account locks", () => {
  it("takes 64 accounts, counting each once, and refuses 65", () => {
    expect(ACCOUNT_LOCK_LIMIT).toBe(64);
    expect(() =>
      refuseTooManyAccounts(attaching(64 - OWN), OWNER, POT, FEE_CONFIG, new Map()),
    ).not.toThrow();
    expect(() =>
      refuseTooManyAccounts(attaching(65 - OWN), OWNER, POT, FEE_CONFIG, new Map()),
    ).toThrow(
      "the cook names 65 accounts, and a Solana transaction locks at most 64: attach fewer",
    );
  });

  it("names the pool each key found, as the program spells it", () => {
    const found = new Map<string, Address | null>([
      ["Orca.Whirlpool(USDC,WSOL,4)", key(7)],
      ["Raydium.CLMM(USDC,WSOL,100,1)", null],
    ]);
    expect(() => refuseTooManyAccounts(attaching(60), OWNER, POT, FEE_CONFIG, found)).toThrow(
      `The program's pools by key: Orca.Whirlpool.pool(USDC, WSOL, 4) is ${key(7)}; ` +
        "Raydium.CLMM.pool(USDC, WSOL, 100, 1) finds none.",
    );
  });
});
