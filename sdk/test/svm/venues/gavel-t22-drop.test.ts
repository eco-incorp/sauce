/**
 * gavel Token-2022 self-drop: a synthesized (otherwise valid) Gavel/Plasma
 * PoolAccount whose baseMint account is a Token-2022 mint must make
 * fetchGavelConfig REJECT (the graceful self-drop signal), while the classic
 * legacy path is unaffected (an unreadable mint falls back to legacy).
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import {
  fetchGavelConfig,
  GAVEL_POOL_SIZE,
  GAVEL_POOL_DISCRIMINANT,
} from "../../../src/svm/venues/gavel/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("CcWf5D6BhUTv2tD4ebFFcmCdTUgBWMc8CqqoJvFHGGXi");
const BASE_MINT = address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const QUOTE_MINT = address("So11111111111111111111111111111111111111112");
const BASE_VAULT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const QUOTE_VAULT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const codec = getAddressCodec();

function writeU64LE(buf: Uint8Array, off: number, val: bigint): void {
  let v = val;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}
function writePubkey(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

function buildPool(): Uint8Array {
  const data = new Uint8Array(GAVEL_POOL_SIZE);
  writeU64LE(data, 0, GAVEL_POOL_DISCRIMINANT); // discriminant
  // baseDecimals u32 @16, quoteDecimals u32 @88
  data[16] = 6;
  data[88] = 9;
  writePubkey(data, 24, BASE_MINT); // OFF_BASE_MINT
  writePubkey(data, 56, BASE_VAULT); // OFF_BASE_VAULT
  writePubkey(data, 96, QUOTE_MINT); // OFF_QUOTE_MINT
  writePubkey(data, 128, QUOTE_VAULT); // OFF_QUOTE_VAULT
  writeU64LE(data, 528, 25n); // feeInBps (u32 read; low bytes)
  writeU64LE(data, 560, 1_000n); // totalLpShares > 0
  writeU64LE(data, 592, 1_000_000n); // baseReserves > 0
  writeU64LE(data, 600, 2_000_000n); // quoteReserves > 0
  return data;
}

function loaderFrom(map: Record<string, Uint8Array>): OwnedAccountLoader {
  return ownedByShape(async (addr: Address) => map[addr] ?? null);
}

describe("gavel Token-2022 self-drop", () => {
  it("REJECTS a pool whose baseMint is a Token-2022 mint", async () => {
    const load = loaderFrom({
      [POOL]: buildPool(),
      [BASE_MINT]: makeT22Mint(),
      [QUOTE_MINT]: makeLegacyMint(),
    });
    await expect(fetchGavelConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("REJECTS a pool whose 82-byte baseMint is owned by Token-2022 (extensionless Token-2022)", async () => {
    const shaped = loaderFrom({
      [POOL]: buildPool(),
      [BASE_MINT]: makeLegacyMint(),
      [QUOTE_MINT]: makeLegacyMint(),
    });
    const load: OwnedAccountLoader = async (addr) =>
      addr === BASE_MINT ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID } : shaped(addr);
    await expect(fetchGavelConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop a classic-legacy pool (byte-identical legacy path)", async () => {
    const load = loaderFrom({
      [POOL]: buildPool(),
      [BASE_MINT]: makeLegacyMint(),
      [QUOTE_MINT]: makeLegacyMint(),
    });
    const cfg = await fetchGavelConfig(load, POOL);
    expect(cfg.venue).toBe("gavel");
    expect(cfg.baseMint).toBe(BASE_MINT);
    expect(cfg.quoteMint).toBe(QUOTE_MINT);
  });

  it("does NOT drop when a mint account is unreadable (falls back to legacy)", async () => {
    const load = loaderFrom({ [POOL]: buildPool() }); // no mint accounts vendored
    const cfg = await fetchGavelConfig(load, POOL);
    expect(cfg.venue).toBe("gavel");
  });
});
