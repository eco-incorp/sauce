/**
 * Kipseli Token-2022 self-drop: this venue's on-chain swap_v2 ix is legacy-SPL
 * (Tokenkeg) only, so fetchPoolConfig must DROP a pool whose base or quote mint
 * is a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). A
 * synthesized 496-byte pool (correct discriminator + mint pubkeys at the real
 * offsets) is enough to reach the mint gate; the drop fires before any vault or
 * decimals read. A classic 82-byte mint on both sides is the legacy control.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { kipseli } from "../../../src/svm/venues/kipseli/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { ownedByShape } from "../fixtures.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("89dvMturcS87kYgrwyeWqqsaFZUi5dQQpBHs6pvfUu3v");
const BASE_MINT = address("So11111111111111111111111111111111111111112"); // wSOL
const QUOTE_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

// Anchor sha256("account:Pool")[:8] and the scoped 496-byte layout.
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
const POOL_ACCOUNT_SIZE = 496;
const OFF_BASE_MINT = 72;
const OFF_QUOTE_MINT = 104;

function synthPool(): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(POOL_DISCRIMINATOR, 0);
  const enc = getAddressEncoder();
  data.set(enc.encode(BASE_MINT), OFF_BASE_MINT);
  data.set(enc.encode(QUOTE_MINT), OFF_QUOTE_MINT);
  return data;
}

function loaderWith(mintBytes: Record<string, Uint8Array>): OwnedAccountLoader {
  const pool = synthPool();
  return ownedByShape(async (addr: Address) => {
    if (addr === POOL) return new Uint8Array(pool);
    const m = mintBytes[addr as string];
    return m === undefined ? null : new Uint8Array(m);
  });
}

describe("kipseli Token-2022 self-drop", () => {
  it("drops the pool when the base mint is a Token-2022 mint", async () => {
    const load = loaderWith({ [BASE_MINT]: makeT22Mint(), [QUOTE_MINT]: makeLegacyMint() });
    await expect(kipseli.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when the quote mint is a Token-2022 mint", async () => {
    const load = loaderWith({ [BASE_MINT]: makeLegacyMint(), [QUOTE_MINT]: makeT22Mint() });
    await expect(kipseli.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when the base mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const shaped = loaderWith({ [QUOTE_MINT]: makeLegacyMint() });
    const load: OwnedAccountLoader = async (addr) =>
      addr === BASE_MINT ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID } : shaped(addr);
    await expect(kipseli.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("passes the mint gate for two classic legacy mints (fails later, never on Token-2022)", async () => {
    const load = loaderWith({ [BASE_MINT]: makeLegacyMint(), [QUOTE_MINT]: makeLegacyMint() });
    let message = "";
    try {
      await kipseli.fetchPoolConfig(load, POOL);
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toMatch(/Token-2022/);
  });
});
