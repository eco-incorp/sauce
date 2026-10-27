/**
 * lemmingsfi Token-2022 self-drop: a pool whose mintA is a Token-2022 (or
 * un-routable) mint must drop; a classic legacy pair still decodes normally.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  fetchLemmingsFiPoolConfig,
  LEMMINGSFI_PROGRAM_ID,
  OFF_MINT_A,
  OFF_MINT_B,
} from "../../../src/svm/venues/lemmingsfi/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const codec = getAddressCodec();
const POOL_ACCOUNT_SIZE = 310;

const POOL = address("So11111111111111111111111111111111111111112");

function addrFromByte(b: number): Address {
  return codec.decode(new Uint8Array(32).fill(b));
}

function buildPool(mintA: Address, mintB: Address): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(codec.encode(mintA), OFF_MINT_A);
  data.set(codec.encode(mintB), OFF_MINT_B);
  // vaultA@72 / vaultB@104 / priceTick@168 / lastUpdateTs@184 stay zero — the
  // drop fires before they matter.
  return data;
}

/** Each entry is an account's address, data and owning program. */
function loaderOf(entries: Array<[Address, Uint8Array, Address]>): OwnedAccountLoader {
  const map = new Map(entries.map(([a, data, owner]) => [a as string, { data, owner }]));
  return async (addr) => {
    const account = map.get(addr as string);
    return account === undefined
      ? null
      : { data: new Uint8Array(account.data), owner: account.owner };
  };
}

describe("lemmingsfi Token-2022 self-drop", () => {
  const mintA = addrFromByte(3);
  const mintB = addrFromByte(5);

  it("drops a pool whose mintA is a Token-2022 mint", async () => {
    const load = loaderOf([
      [POOL, buildPool(mintA, mintB), LEMMINGSFI_PROGRAM_ID],
      [mintA, makeT22Mint(), TOKEN_2022_PROGRAM_ID],
      [mintB, makeLegacyMint(), TOKEN_PROGRAM_ID],
    ]);
    await expect(fetchLemmingsFiPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose mintA is an extensionless 82-byte mint owned by Token-2022", async () => {
    const load = loaderOf([
      [POOL, buildPool(mintA, mintB), LEMMINGSFI_PROGRAM_ID],
      [mintA, makeLegacyMint(), TOKEN_2022_PROGRAM_ID],
      [mintB, makeLegacyMint(), TOKEN_PROGRAM_ID],
    ]);
    await expect(fetchLemmingsFiPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose mintA carries an un-routable extension", async () => {
    const load = loaderOf([
      [POOL, buildPool(mintA, mintB), LEMMINGSFI_PROGRAM_ID],
      [mintA, makeT22Mint(NON_TRANSFERABLE_TLV), TOKEN_2022_PROGRAM_ID],
      [mintB, makeLegacyMint(), TOKEN_PROGRAM_ID],
    ]);
    await expect(fetchLemmingsFiPoolConfig(load, POOL)).rejects.toThrow(/Token-2022|un-routable/);
  });

  it("decodes a classic legacy pair unchanged", async () => {
    const load = loaderOf([
      [POOL, buildPool(mintA, mintB), LEMMINGSFI_PROGRAM_ID],
      [mintA, makeLegacyMint(), TOKEN_PROGRAM_ID],
      [mintB, makeLegacyMint(), TOKEN_PROGRAM_ID],
    ]);
    const cfg = await fetchLemmingsFiPoolConfig(load, POOL);
    expect(cfg.venue).toBe("lemmingsfi");
    expect(cfg.mintA).toBe(mintA);
    expect(cfg.mintB).toBe(mintB);
  });
});
