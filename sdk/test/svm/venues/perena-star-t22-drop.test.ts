/**
 * Perena Star Token-2022 self-drop: stake_junior / instant_unstake_junior move
 * both mints via a legacy-SPL (Tokenkeg) token program, so a Token-2022 mint
 * must make fetchPoolConfig THROW. No mainnet fixture is vendored, so this
 * builds a minimal synthetic 448-byte TrancheState. With legacy mints the gate
 * is passed and the flow reaches the (unprovided) bank load — proving the legacy
 * path is byte-identical.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { AccountLoader } from '../../../src/svm/index.js';
import { perenaStar } from '../../../src/svm/venues/perena-star/index.js';
import { makeT22Mint, makeLegacyMint } from '../fixtures/token-2022/synth.js';

const POOL = address('hXfEYpB5FB3ZWjGNc5C5JqLixmGdmZFyjXKJB2xFPgc');
const BANK = address('sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A');
const BANK_MINT = address('So11111111111111111111111111111111111111112'); // stand-in bank mint
const JUNIOR_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // stand-in junior mint
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

function loaderWith(bankMintData: Uint8Array | null, juniorMintData: Uint8Array | null): AccountLoader {
  const tranche = makeTranche();
  return async (addr) => {
    if (addr === POOL) return new Uint8Array(tranche);
    if (addr === BANK_MINT) return bankMintData === null ? null : new Uint8Array(bankMintData);
    if (addr === JUNIOR_MINT) return juniorMintData === null ? null : new Uint8Array(juniorMintData);
    return null; // BANK is intentionally not provided
  };
}

describe('perena-star Token-2022 self-drop', () => {
  it('drops the pool when the bank mint is Token-2022', async () => {
    await expect(perenaStar.fetchPoolConfig(loaderWith(makeT22Mint(), makeLegacyMint()), POOL)).rejects.toThrow(
      /is Token-2022/,
    );
  });

  it('drops the pool when the junior mint is Token-2022', async () => {
    await expect(perenaStar.fetchPoolConfig(loaderWith(makeLegacyMint(), makeT22Mint()), POOL)).rejects.toThrow(
      /is Token-2022/,
    );
  });

  it('passes the Token-2022 gate for two legacy mints (reaches the bank load)', async () => {
    // The bank account is intentionally not provided, so passing the mint gate
    // surfaces the bank-not-found error — proof the legacy mints got past the
    // Token-2022 safety block unchanged.
    await expect(perenaStar.fetchPoolConfig(loaderWith(makeLegacyMint(), makeLegacyMint()), POOL)).rejects.toThrow(
      `perena-star bank ${BANK} not found`,
    );
  });
});
