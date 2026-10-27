/**
 * trends Token-2022 handling: a zero-fee Token-2022 base mint ROUTES (is NOT
 * dropped) and resolves to the Token-2022 program; a legacy base mint decodes
 * byte-identically. A NonTransferable base mint self-drops; a TransferFeeConfig
 * base mint is still rejected (see the TODO(t22-fee-netting) note in the adapter).
 * The quote side is always WSOL (a classic legacy mint), so only the base side is
 * per-mint resolved.
 */
import { getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { fetchTrendsPoolConfig } from "../../../src/svm/venues/trends/index.js";
import type { AccountLoader, OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import {
  makeLegacyMint,
  makeT22Mint,
  NON_TRANSFERABLE_TLV,
  tlvEntry,
} from "../fixtures/token-2022/synth.js";

const dec = getAddressDecoder();
const aenc = getAddressEncoder();
const addr = (s: string): Address => s as unknown as Address;
const addrFromByte = (b: number): Address => dec.decode(new Uint8Array(32).fill(b));
const putAddr = (data: Uint8Array, offset: number, a: Address): void =>
  data.set(new Uint8Array(aenc.encode(a)), offset);

const TOKEN_PROGRAM = addr("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = addr("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const POOL_DISCRIMINATOR = Uint8Array.of(0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc);
const POOL = addrFromByte(1);
const BASE_VAULT = addrFromByte(4);
const QUOTE_VAULT = addrFromByte(5);
const BASE_MINT = addrFromByte(11);

function pool(): Uint8Array {
  const data = new Uint8Array(312);
  data.set(POOL_DISCRIMINATOR, 0);
  putAddr(data, 40, BASE_MINT);
  putAddr(data, 72, BASE_VAULT);
  putAddr(data, 104, QUOTE_VAULT);
  data[184] = 0; // is_migrated = false
  return data;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (a) => {
    const d = map.get(a as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

/** The pool's accounts, each owned as its bytes would be; `mintOwner` overrides the base mint's. */
function loaderFor(baseMint: Uint8Array, mintOwner?: Address): OwnedAccountLoader {
  const shaped = ownedByShape(
    loaderOf([
      [POOL, pool()],
      [BASE_MINT, baseMint],
    ]),
  );
  if (mintOwner === undefined) return shaped;
  return async (a) =>
    a === BASE_MINT ? { data: new Uint8Array(baseMint), owner: mintOwner } : shaped(a);
}

describe("trends Token-2022 handling", () => {
  it("decodes a legacy base mint (baseline)", async () => {
    const cfg = await fetchTrendsPoolConfig(loaderFor(makeLegacyMint()), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_PROGRAM);
    expect(cfg.baseMint).toBe(BASE_MINT);
  });

  it("ROUTES a zero-fee Token-2022 base mint (not dropped)", async () => {
    const cfg = await fetchTrendsPoolConfig(loaderFor(makeT22Mint()), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM);
  });

  it("resolves an extensionless (82-byte) Token-2022 base mint to Token-2022 by its owner", async () => {
    const cfg = await fetchTrendsPoolConfig(loaderFor(makeLegacyMint(), TOKEN_2022_PROGRAM), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM);
  });

  it("self-drops a NonTransferable base mint", async () => {
    await expect(
      fetchTrendsPoolConfig(loaderFor(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/un-routable|NonTransferable/);
  });

  it("still rejects a TransferFeeConfig base mint (see TODO(t22-fee-netting))", async () => {
    await expect(
      fetchTrendsPoolConfig(loaderFor(makeT22Mint(tlvEntry(1, new Uint8Array(108)))), POOL),
    ).rejects.toThrow(/TransferFeeConfig/);
  });

  it("refuses an 82-byte base mint owned by neither token program", async () => {
    const foreign = addr("11111111111111111111111111111111");
    await expect(fetchTrendsPoolConfig(loaderFor(makeLegacyMint(), foreign), POOL)).rejects.toThrow(
      `token-program: mint ${BASE_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
