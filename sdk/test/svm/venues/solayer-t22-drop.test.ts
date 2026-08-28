/**
 * solayer Token-2022 self-drop: an EndoAVS pool one of whose mints
 * (receipt/lst) is a Token-2022 mint must SELF-DROP (fetchSolayerPoolConfig
 * throws — SvmRoute catches the throw and drops the venue) because both
 * directions transfer/mint/burn through the classic Tokenkeg program.
 * Synthesizes a minimal 443-byte EndoAVS account (discriminator + mint/vault
 * slots + empty name) and answers a Token-2022 mint for the mint accounts.
 */
import { address } from '@solana/kit';
import { fetchSolayerPoolConfig, ENDO_AVS_DISCRIMINATOR } from '../../../src/svm/venues/solayer/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeT22Mint } from '../fixtures/token-2022/synth.js';

const ENDO_AVS_ACCOUNT_SIZE = 443;
const POOL = address('So11111111111111111111111111111111111111112');

describe('solayer: Token-2022 mint self-drop', () => {
  it('rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)', async () => {
    const buf = new Uint8Array(ENDO_AVS_ACCOUNT_SIZE);
    buf.set(Uint8Array.from(ENDO_AVS_DISCRIMINATOR), 0); // discriminator @0
    buf.set(new Uint8Array(32).fill(7), 41); // receiptMint @41
    buf.set(new Uint8Array(32).fill(9), 73); // lstMint @73
    buf.set(new Uint8Array(32).fill(11), 105); // vault @105
    // name length @137 stays 0 (empty name, valid).

    const load: AccountLoader = async (addr) => (addr === POOL ? new Uint8Array(buf) : makeT22Mint());
    await expect(fetchSolayerPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });
});
