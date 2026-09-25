/**
 * runner-rodeo Token-2022 handling: a zero-fee Token-2022 base mint ROUTES (is NOT
 * dropped) and resolves to the Token-2022 program; a legacy base mint decodes
 * byte-identically. A NonTransferable base mint self-drops. The venue's existing,
 * validated transfer-fee gate is preserved byte-for-byte: a fee whose
 * withdrawWithheldAuthority is the program's own authority PDA is ACCEPTED (the
 * Swap CPI self-harvests it), while a fee controlled by any other authority is
 * REJECTED (see the TODO(t22-fee-netting) note in the adapter).
 */
import { getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { runnerRodeo } from "../../../src/svm/venues/runner-rodeo/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
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

const WSOL = addr("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = addr("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = addr("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/** PDA(["authority"], program) — the program's own withheld-fee authority (see adapter header). */
const AUTHORITY = addr("7Eg1rRYr2WqEWTvqkzG1ApuB91WbZ4qzY7V6BfXtjwQR");

const POOL_STATE_DISCRIMINATOR = Uint8Array.of(0xd5, 0xd2, 0xe3, 0xbf, 0x30, 0xaa, 0xde, 0x72);

const POOL = addrFromByte(1);
const CONFIG = addrFromByte(2);
const PARTNER = addrFromByte(3);
const BASE_VAULT = addrFromByte(4);
const QUOTE_VAULT = addrFromByte(5);
const BASE_MINT = addrFromByte(11);

function poolState(): Uint8Array {
  const data = new Uint8Array(313);
  data.set(POOL_STATE_DISCRIMINATOR, 0);
  putAddr(data, 8, CONFIG);
  putAddr(data, 72, BASE_VAULT);
  putAddr(data, 104, QUOTE_VAULT);
  putAddr(data, 185, BASE_MINT);
  putAddr(data, 217, WSOL);
  return data;
}

function config(): Uint8Array {
  const data = new Uint8Array(90);
  putAddr(data, 9, PARTNER);
  const dv = new DataView(data.buffer);
  dv.setUint16(73, 60, true); // creatorFeeBps
  dv.setUint16(75, 5, true); // protocolFeeBpsA
  dv.setUint16(77, 55, true); // protocolFeeBpsB
  return data;
}

/** A 108-byte TransferFeeConfig value: withdrawWithheldAuthority @32, older bps @88. */
function transferFeeValue(withdrawAuthority: Address, olderBps: number): Uint8Array {
  const value = new Uint8Array(108);
  putAddr(value, 32, withdrawAuthority);
  new DataView(value.buffer).setUint16(88, olderBps, true);
  return value;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (a) => {
    const d = map.get(a as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

const loaderFor = (baseMint: Uint8Array): AccountLoader =>
  loaderOf([
    [POOL, poolState()],
    [CONFIG, config()],
    [BASE_MINT, baseMint],
  ]);

describe("runner-rodeo Token-2022 handling", () => {
  it("decodes a legacy base mint (baseline)", async () => {
    const cfg = await runnerRodeo.fetchPoolConfig(loaderFor(makeLegacyMint()), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_PROGRAM);
    expect(cfg.baseMint).toBe(BASE_MINT);
  });

  it("ROUTES a zero-fee Token-2022 base mint (not dropped)", async () => {
    const cfg = await runnerRodeo.fetchPoolConfig(loaderFor(makeT22Mint()), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM);
  });

  it("self-drops a NonTransferable base mint", async () => {
    await expect(
      runnerRodeo.fetchPoolConfig(loaderFor(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/un-routable|NonTransferable/);
  });

  it("ACCEPTS a fee whose withdraw authority is the program authority (self-harvested)", async () => {
    const mint = makeT22Mint(tlvEntry(1, transferFeeValue(AUTHORITY, 120)));
    const cfg = await runnerRodeo.fetchPoolConfig(loaderFor(mint), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM);
  });

  it("REJECTS a fee controlled by a foreign withdraw authority", async () => {
    const foreign = addrFromByte(99);
    const mint = makeT22Mint(tlvEntry(1, transferFeeValue(foreign, 120)));
    await expect(runnerRodeo.fetchPoolConfig(loaderFor(mint), POOL)).rejects.toThrow(
      /transfer fee/i,
    );
  });
});
