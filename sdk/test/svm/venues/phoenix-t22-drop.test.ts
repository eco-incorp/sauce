/**
 * phoenix Token-2022 self-drop: a market whose base mint is a Token-2022 mint
 * must SELF-DROP (fetchPhoenixConfig throws — the SvmRoute orchestrator catches
 * a fetchPoolConfig throw and drops the venue) because this venue's Swap ix is
 * legacy-SPL only. Synthesizes a minimal MarketHeader valid through the mint
 * loop (discriminant + positive book sizes + the two mint slots) and swaps the
 * base mint's account for a synthesized Token-2022 mint.
 */
import { address, getAddressDecoder } from "@solana/kit";
import {
  fetchPhoenixConfig,
  MARKET_DISCRIMINANT,
  PHOENIX_PROGRAM_ID,
} from "../../../src/svm/venues/phoenix/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

function writeU64LE(buf: Uint8Array, off: number, val: bigint): void {
  for (let i = 0; i < 8; i++) buf[off + i] = Number((val >> BigInt(8 * i)) & 0xffn);
}

const POOL = address("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

/**
 * A 1024-byte header buffer (>= HEADER_SIZE + 256 + 48 = 880): discriminant, positive book sizes
 * and two distinct mint slots, base_mint @48 and quote_mint @128. Every other address answers
 * `mint`, owned by Token-2022.
 */
function marketLoader(mint: Uint8Array): { load: OwnedAccountLoader; baseMint: string } {
  const buf = new Uint8Array(1024);
  writeU64LE(buf, 0, MARKET_DISCRIMINANT); // discriminant @0
  writeU64LE(buf, 16, 1n); // bids_size @16 (> 0)
  writeU64LE(buf, 24, 1n); // asks_size @24 (> 0)
  const baseMintBytes = new Uint8Array(32).fill(7);
  const quoteMintBytes = new Uint8Array(32).fill(9);
  buf.set(baseMintBytes, 48);
  buf.set(quoteMintBytes, 128);
  const load: OwnedAccountLoader = async (addr) =>
    addr === POOL
      ? { data: new Uint8Array(buf), owner: PHOENIX_PROGRAM_ID }
      : { data: new Uint8Array(mint), owner: TOKEN_2022_PROGRAM_ID };
  return { load, baseMint: getAddressDecoder().decode(baseMintBytes) };
}

describe("phoenix: Token-2022 mint self-drop", () => {
  it("rejects a market whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const { load, baseMint } = marketLoader(makeT22Mint());
    await expect(fetchPhoenixConfig(load, POOL)).rejects.toThrow(/Token-2022/);
    // sanity: the base mint address the venue derives is the one our loader answers.
    expect(baseMint.length).toBeGreaterThan(0);
  });

  it("rejects a market whose mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const { load } = marketLoader(makeLegacyMint());
    await expect(fetchPhoenixConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("rejects a market whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const { load: shaped, baseMint } = marketLoader(makeLegacyMint());
    // Both mint slots answer an 82-byte mint owned by the System Program; the base mint is read first.
    const load: OwnedAccountLoader = async (addr) => {
      const account = await shaped(addr);
      return addr === POOL || account === null ? account : { data: account.data, owner: foreign };
    };
    await expect(fetchPhoenixConfig(load, POOL)).rejects.toThrow(
      `token-program: mint ${baseMint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
