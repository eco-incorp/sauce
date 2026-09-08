/**
 * binaryfi Token-2022 self-drop: a Market whose asset/quote mint is a
 * Token-2022 mint (or one carrying a blocking extension) must REJECT at
 * fetchPoolConfig. The on-chain swap ix (disc 0x08) is legacy-SPL only (a
 * single token_program slot, listed twice).
 */
import { getAddressDecoder } from "@solana/kit";
import { binaryfi } from "../../../src/svm/venues/binaryfi/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = getAddressDecoder().decode(
  Uint8Array.from({ length: 32 }, (_, i) => ((i * 3) % 250) + 1),
);

const MARKET_ACCOUNT_SIZE = 666;
const MARKET_DISCRIMINATOR_HEX = "f7ede3f5d7c3de46";
const OFF_ASSET_MINT = 42;

const mintBytes = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((i * 19) % 250) + 1;
  return b;
})();
const T22_MINT = getAddressDecoder().decode(mintBytes);

function marketBytes(): Uint8Array {
  const data = new Uint8Array(MARKET_ACCOUNT_SIZE);
  data.set(Uint8Array.from(Buffer.from(MARKET_DISCRIMINATOR_HEX, "hex")), 0);
  data.set(mintBytes, OFF_ASSET_MINT); // assetMint -> the Token-2022 mint
  return data;
}

function loaderWith(mint: Uint8Array | null): AccountLoader {
  return (async (a: string) => {
    if (a === POOL) return marketBytes();
    if (a === T22_MINT) return mint;
    return null;
  }) as unknown as AccountLoader;
}

describe("binaryfi Token-2022 self-drop", () => {
  it("drops a market whose asset mint is a Token-2022 mint", async () => {
    await expect(binaryfi.fetchPoolConfig(loaderWith(makeT22Mint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops a market whose asset mint is a Token-2022 mint carrying an extension", async () => {
    await expect(
      binaryfi.fetchPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop for an unreadable mint (falls back to the legacy assumption)", async () => {
    // mint load null -> continue -> no T22 drop; fetch fails LATER on the missing
    // calibrated floor rate, never with a T22/un-routable message.
    await binaryfi.fetchPoolConfig(loaderWith(null), POOL).catch((e: unknown) => {
      expect(String(e)).not.toMatch(/Token-2022|un-routable/);
    });
  });
});
