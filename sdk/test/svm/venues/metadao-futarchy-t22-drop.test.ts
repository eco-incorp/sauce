/**
 * metadao-futarchy Token-2022 self-drop: a Spot-state dao whose base mint is a
 * Token-2022 (or un-routable) mint must drop; a classic legacy dao still decodes.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { fetchMetaDaoFutarchySpotConfig } from "../../../src/svm/venues/metadao-futarchy/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const codec = getAddressCodec();
const DAO_ACCOUNT_SIZE = 1264; // the Dao after the 2026-10-20 program upgrade (was 1205)
const DAO_DISCRIMINATOR = [0xa3, 0x09, 0x2f, 0x1f, 0x34, 0x55, 0xc5, 0x31];
const QUOTE_RESERVES_OFFSET = 109;
const BASE_RESERVES_OFFSET = 117;
const BASE_MINT_OFFSET = 157;
const QUOTE_MINT_OFFSET = 189;

const DAO = address("So11111111111111111111111111111111111111112");

function addrFromByte(b: number): Address {
  return codec.decode(new Uint8Array(32).fill(b));
}

function buildDao(baseMint: Address, quoteMint: Address): Uint8Array {
  const data = new Uint8Array(DAO_ACCOUNT_SIZE);
  data.set(DAO_DISCRIMINATOR, 0);
  data[8] = 0; // PoolState::Spot
  new DataView(data.buffer).setBigUint64(QUOTE_RESERVES_OFFSET, 1_000_000n, true);
  new DataView(data.buffer).setBigUint64(BASE_RESERVES_OFFSET, 1_000_000n, true);
  data.set(codec.encode(baseMint), BASE_MINT_OFFSET);
  data.set(codec.encode(quoteMint), QUOTE_MINT_OFFSET);
  return data;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (addr) => {
    const d = map.get(addr as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

describe("metadao-futarchy Token-2022 self-drop", () => {
  const baseMint = addrFromByte(3);
  const quoteMint = addrFromByte(5);

  it("drops a dao whose base mint is a Token-2022 mint", async () => {
    const load = loaderOf([
      [DAO, buildDao(baseMint, quoteMint)],
      [baseMint, makeT22Mint()],
    ]);
    await expect(fetchMetaDaoFutarchySpotConfig(load, DAO)).rejects.toThrow(/Token-2022/);
  });

  it("drops a dao whose base mint carries an un-routable extension", async () => {
    const load = loaderOf([
      [DAO, buildDao(baseMint, quoteMint)],
      [baseMint, makeT22Mint(NON_TRANSFERABLE_TLV)],
    ]);
    await expect(fetchMetaDaoFutarchySpotConfig(load, DAO)).rejects.toThrow(
      /Token-2022|un-routable/,
    );
  });

  it("decodes a classic legacy dao unchanged", async () => {
    const load = loaderOf([
      [DAO, buildDao(baseMint, quoteMint)],
      [baseMint, makeLegacyMint()],
      [quoteMint, makeLegacyMint()],
    ]);
    const cfg = await fetchMetaDaoFutarchySpotConfig(load, DAO);
    expect(cfg.venue).toBe("metadao-futarchy");
    expect(cfg.baseMint).toBe(baseMint);
    expect(cfg.quoteMint).toBe(quoteMint);
  });
});
