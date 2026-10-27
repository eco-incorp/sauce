/**
 * invariant Token-2022 self-drop: a pool whose tokenX mint is a Token-2022 mint
 * must drop (fetchPoolConfig throws) rather than silently assuming legacy SPL.
 * The legacy path stays byte-identical (an 82-byte classic mint does not drop).
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  fetchInvariantPoolConfig,
  INVARIANT_PROGRAM_ID,
  POOL_ACCOUNT_SIZE,
  POOL_DISCRIMINATOR,
} from "../../../src/svm/venues/invariant/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const codec = getAddressCodec();
const OFF_TOKEN_X = 8;
const OFF_TOKEN_Y = 40;

const POOL = address("So11111111111111111111111111111111111111112");

/** Distinct valid addresses derived from a fill byte. */
function addrFromByte(b: number): Address {
  return codec.decode(new Uint8Array(32).fill(b));
}

function buildPool(tokenX: Address, tokenY: Address): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(POOL_DISCRIMINATOR, 0);
  data.set(codec.encode(tokenX), OFF_TOKEN_X);
  data.set(codec.encode(tokenY), OFF_TOKEN_Y);
  // tickmap @222 and other fields stay zero — the drop fires before they're used.
  return data;
}

/** Each entry is [address, data] (owned as its shape implies) or [address, data, owner]. */
function loaderOf(
  entries: Array<[Address, Uint8Array] | [Address, Uint8Array, Address]>,
): OwnedAccountLoader {
  const map = new Map(entries.map(([a, d, o]) => [a as string, { d, o }]));
  return async (addr) => {
    const e = map.get(addr as string);
    if (e === undefined) return null;
    const owner =
      e.o ??
      (addr === POOL
        ? INVARIANT_PROGRAM_ID
        : e.d.length === 82
          ? TOKEN_PROGRAM_ID
          : TOKEN_2022_PROGRAM_ID);
    return { data: new Uint8Array(e.d), owner };
  };
}

describe("invariant Token-2022 self-drop", () => {
  const tokenX = addrFromByte(7);
  const tokenY = addrFromByte(9);

  it("drops a pool whose tokenX mint is a Token-2022 mint", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeT22Mint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose mint carries an un-routable extension (NonTransferable)", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeT22Mint(NON_TRANSFERABLE_TLV)],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022|un-routable/);
  });

  it("drops a pool whose 82-byte tokenX mint is owned by Token-2022 (extensionless Token-2022)", async () => {
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeLegacyMint(), TOKEN_2022_PROGRAM_ID],
      [tokenY, makeLegacyMint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop for a classic 82-byte legacy mint (proceeds past the guard)", async () => {
    // Both mints legacy — the drop guard passes; the fetch proceeds and fails
    // later on the missing tickmap, proving the guard itself did not fire.
    const load = loaderOf([
      [POOL, buildPool(tokenX, tokenY)],
      [tokenX, makeLegacyMint()],
      [tokenY, makeLegacyMint()],
    ]);
    await expect(fetchInvariantPoolConfig(load, POOL)).rejects.not.toThrow(
      /Token-2022|un-routable/,
    );
  });
});
