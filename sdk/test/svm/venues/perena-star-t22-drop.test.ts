/**
 * Perena Star Token-2022 self-drop: stake_junior / instant_unstake_junior move
 * both mints via a legacy-SPL (Tokenkeg) token program, so a Token-2022 mint
 * must make fetchPoolConfig THROW. No mainnet fixture is vendored, so this
 * builds a minimal synthetic 448-byte TrancheState. With legacy mints the gate
 * is passed and the flow reaches the (unprovided) bank load — proving the legacy
 * path is byte-identical. The mint is classified by its OWNER: an extensionless
 * Token-2022 mint is 82 bytes, byte for byte a legacy one.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { PERENA_STAR_PROGRAM_ID, perenaStar } from "../../../src/svm/venues/perena-star/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("hXfEYpB5FB3ZWjGNc5C5JqLixmGdmZFyjXKJB2xFPgc");
const BANK = address("sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A");
const BANK_MINT = address("So11111111111111111111111111111111111111112"); // stand-in bank mint
const JUNIOR_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // stand-in junior mint
const TRANCHE_STATE_DISCRIMINATOR = [212, 231, 254, 24, 238, 63, 92, 105];

/** A minimal 448-byte TrancheState: disc + bank@16 + mint@48 + share_mint@80. */
function makeTranche(): Uint8Array {
  const buf = new Uint8Array(448);
  buf.set(TRANCHE_STATE_DISCRIMINATOR, 0);
  const codec = getAddressCodec();
  buf.set(codec.encode(BANK), 16);
  buf.set(codec.encode(BANK_MINT), 48);
  buf.set(codec.encode(JUNIOR_MINT), 80);
  return buf;
}

type Account = { data: Uint8Array; owner: Address };
const t22 = (data: Uint8Array): Account => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (data: Uint8Array): Account => ({ data, owner: TOKEN_PROGRAM_ID });

function loaderWith(bankMint: Account | null, juniorMint: Account | null): OwnedAccountLoader {
  const tranche = makeTranche();
  const copy = (account: Account | null): Account | null =>
    account === null ? null : { data: new Uint8Array(account.data), owner: account.owner };
  return async (addr) => {
    if (addr === POOL) return { data: new Uint8Array(tranche), owner: PERENA_STAR_PROGRAM_ID };
    if (addr === BANK_MINT) return copy(bankMint);
    if (addr === JUNIOR_MINT) return copy(juniorMint);
    return null; // BANK is intentionally not provided
  };
}

describe("perena-star Token-2022 self-drop", () => {
  it("drops the pool when the bank mint is Token-2022", async () => {
    await expect(
      perenaStar.fetchPoolConfig(loaderWith(t22(makeT22Mint()), legacy(makeLegacyMint())), POOL),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when the junior mint is Token-2022", async () => {
    await expect(
      perenaStar.fetchPoolConfig(loaderWith(legacy(makeLegacyMint()), t22(makeT22Mint())), POOL),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when the bank mint is 82 bytes but owned by Token-2022 (extensionless)", async () => {
    await expect(
      perenaStar.fetchPoolConfig(loaderWith(t22(makeLegacyMint()), legacy(makeLegacyMint())), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("passes the Token-2022 gate for two legacy mints (reaches the bank load)", async () => {
    // The bank account is intentionally not provided, so passing the mint gate
    // surfaces the bank-not-found error — proof the legacy mints got past the
    // Token-2022 safety block unchanged.
    await expect(
      perenaStar.fetchPoolConfig(
        loaderWith(legacy(makeLegacyMint()), legacy(makeLegacyMint())),
        POOL,
      ),
    ).rejects.toThrow(`perena-star bank ${BANK} not found`);
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const foreignMint: Account = { data: makeLegacyMint(), owner: foreign };
    await expect(
      perenaStar.fetchPoolConfig(loaderWith(foreignMint, legacy(makeLegacyMint())), POOL),
    ).rejects.toThrow(
      `token-program: mint ${BANK_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
    await expect(
      perenaStar.fetchPoolConfig(loaderWith(legacy(makeLegacyMint()), foreignMint), POOL),
    ).rejects.toThrow(
      `token-program: mint ${JUNIOR_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
