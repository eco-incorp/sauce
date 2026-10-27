/**
 * cropper Token-2022 self-drop: a Whirlpool-shaped pool whose token mint is a
 * Token-2022 mint (or one carrying a blocking extension) must REJECT at
 * fetchPoolConfig. The swap ix is classic-SPL (Tokenkeg) only.
 */
import { address, getAddressDecoder } from "@solana/kit";
import {
  cropper,
  CROPPER_POOL_ACCOUNT_SIZE,
  CROPPER_PROGRAM_ID,
} from "../../../src/svm/venues/cropper/index.js";
import { WHIRLPOOL_DISCRIMINATOR } from "../../../src/svm/venues/orca-whirlpool/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = getAddressDecoder().decode(
  Uint8Array.from({ length: 32 }, (_, i) => ((i * 3) % 250) + 1),
);

const OFF_MINT_A = 101;
// fee_tier_index (@OFF_FEE_TIER_INDEX) and tick_spacing (@OFF_TICK_SPACING) both
// stay 0 -> equal -> the adaptive-fee gate passes before the mint block.

const mintBytes = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((i * 13) % 250) + 1;
  return b;
})();
const T22_MINT = getAddressDecoder().decode(mintBytes);

function poolBytes(): Uint8Array {
  const data = new Uint8Array(CROPPER_POOL_ACCOUNT_SIZE);
  data.set(WHIRLPOOL_DISCRIMINATOR, 0);
  data.set(mintBytes, OFF_MINT_A); // tokenMintA -> the Token-2022 mint
  return data;
}

function loaderWith(
  mint: Uint8Array | null,
  owner: string = TOKEN_2022_PROGRAM_ID,
): OwnedAccountLoader {
  return (async (a: string) => {
    if (a === POOL) return { data: poolBytes(), owner: CROPPER_PROGRAM_ID };
    if (a === T22_MINT) return mint === null ? null : { data: mint, owner };
    return null;
  }) as unknown as OwnedAccountLoader;
}

describe("cropper Token-2022 self-drop", () => {
  it("drops a pool whose mint is a Token-2022 mint", async () => {
    await expect(cropper.fetchPoolConfig(loaderWith(makeT22Mint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops a pool whose mint is a Token-2022 mint carrying an extension", async () => {
    await expect(
      cropper.fetchPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose 82-byte mint is owned by Token-2022 (extensionless Token-2022)", async () => {
    await expect(cropper.fetchPoolConfig(loaderWith(makeLegacyMint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("does NOT drop for an 82-byte mint owned by the legacy token program", async () => {
    await cropper
      .fetchPoolConfig(loaderWith(makeLegacyMint(), TOKEN_PROGRAM_ID), POOL)
      .catch((e: unknown) => {
        expect(String(e)).not.toMatch(/Token-2022|un-routable/);
      });
  });

  it("does NOT drop for an unreadable mint (falls back to the legacy assumption)", async () => {
    // A null mint -> `continue` -> no Token-2022 drop. The fetch then either
    // resolves or fails for an unrelated reason, but NEVER with a T22 message.
    await cropper.fetchPoolConfig(loaderWith(null), POOL).catch((e: unknown) => {
      expect(String(e)).not.toMatch(/Token-2022|un-routable/);
    });
  });

  it("refuses a pool whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    await expect(
      cropper.fetchPoolConfig(loaderWith(makeLegacyMint(), foreign), POOL),
    ).rejects.toThrow(
      `token-program: mint ${T22_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
