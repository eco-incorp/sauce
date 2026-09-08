/**
 * byreal Token-2022 self-drop: a pool whose token mint is a Token-2022 mint (or
 * one carrying a blocking extension) must REJECT at fetchPoolConfig — the
 * graceful-drop signal the SvmRoute orchestrator catches. The on-chain swap ix
 * is legacy-SPL only for now.
 */
import { getAddressDecoder } from "@solana/kit";
import { byreal } from "../../../src/svm/venues/byreal/index.js";
import { POOL_DISCRIMINATOR } from "../../../src/svm/venues/raydium-clmm/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = getAddressDecoder().decode(
  Uint8Array.from({ length: 32 }, (_, i) => ((i * 3) % 250) + 1),
);

const OFF_TOKEN_MINT_0 = 73;

// A 32-byte mint pubkey (first byte non-zero to avoid base58 leading-zero edge cases).
const mintBytes = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((i * 7) % 250) + 1;
  return b;
})();
const T22_MINT = getAddressDecoder().decode(mintBytes);

function poolBytes(): Uint8Array {
  const data = new Uint8Array(1544);
  data.set(POOL_DISCRIMINATOR, 0);
  data.set(mintBytes, OFF_TOKEN_MINT_0); // tokenMint0 -> the Token-2022 mint
  // status (@389), fee_on (@390) and dynamic_fee_info (@1096..) all stay zero.
  return data;
}

function loaderWith(mint: Uint8Array | null): AccountLoader {
  return (async (a: string) => {
    if (a === POOL) return poolBytes();
    if (a === T22_MINT) return mint;
    return null;
  }) as unknown as AccountLoader;
}

describe("byreal Token-2022 self-drop", () => {
  it("drops a pool whose mint is a Token-2022 mint", async () => {
    await expect(byreal.fetchPoolConfig(loaderWith(makeT22Mint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops a pool whose mint is a Token-2022 mint carrying an extension", async () => {
    await expect(
      byreal.fetchPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop for an unreadable mint (falls back to the legacy assumption)", async () => {
    // A null mint -> `continue` -> no Token-2022 drop. The fetch then either
    // resolves or fails for an unrelated reason, but NEVER with a T22 message.
    await byreal.fetchPoolConfig(loaderWith(null), POOL).catch((e: unknown) => {
      expect(String(e)).not.toMatch(/Token-2022|un-routable/);
    });
  });
});
