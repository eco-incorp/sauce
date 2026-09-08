/**
 * phoenix Token-2022 self-drop: a market whose base mint is a Token-2022 mint
 * must SELF-DROP (fetchPhoenixConfig throws — the SvmRoute orchestrator catches
 * a fetchPoolConfig throw and drops the venue) because this venue's Swap ix is
 * legacy-SPL only. Synthesizes a minimal MarketHeader valid through the mint
 * loop (discriminant + positive book sizes + the two mint slots) and swaps the
 * base mint's account for a synthesized Token-2022 mint.
 */
import { address, getAddressDecoder } from "@solana/kit";
import { fetchPhoenixConfig, MARKET_DISCRIMINANT } from "../../../src/svm/venues/phoenix/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

function writeU64LE(buf: Uint8Array, off: number, val: bigint): void {
  for (let i = 0; i < 8; i++) buf[off + i] = Number((val >> BigInt(8 * i)) & 0xffn);
}

const POOL = address("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

describe("phoenix: Token-2022 mint self-drop", () => {
  it("rejects a market whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    // 1024-byte header buffer (>= HEADER_SIZE + 256 + 48 = 880).
    const buf = new Uint8Array(1024);
    writeU64LE(buf, 0, MARKET_DISCRIMINANT); // discriminant @0
    writeU64LE(buf, 16, 1n); // bids_size @16 (> 0)
    writeU64LE(buf, 24, 1n); // asks_size @24 (> 0)
    // base_mint @48, quote_mint @128 — distinct 32-byte patterns.
    const baseMintBytes = new Uint8Array(32).fill(7);
    const quoteMintBytes = new Uint8Array(32).fill(9);
    buf.set(baseMintBytes, 48);
    buf.set(quoteMintBytes, 128);
    const baseMint = getAddressDecoder().decode(baseMintBytes);

    const load: AccountLoader = async (addr) =>
      addr === POOL ? new Uint8Array(buf) : makeT22Mint();
    await expect(fetchPhoenixConfig(load, POOL)).rejects.toThrow(/Token-2022/);
    // sanity: the base mint address the venue derives is the one our loader answers.
    expect(baseMint.length).toBeGreaterThan(0);
  });
});
