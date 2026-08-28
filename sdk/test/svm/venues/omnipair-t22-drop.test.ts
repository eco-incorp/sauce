/**
 * omnipair Token-2022 self-drop: a synthesized (otherwise valid) Pair account
 * whose token0Mint is a Token-2022 mint must make fetchOmnipairPoolConfig
 * REJECT (the graceful self-drop signal); the legacy path is unaffected.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountLoader } from '../../../src/svm/index.js';
import { fetchOmnipairPoolConfig, PAIR_ACCOUNT_SIZE, PAIR_DISCRIMINATOR } from '../../../src/svm/venues/omnipair/index.js';
import { makeT22Mint, makeLegacyMint } from '../fixtures/token-2022/synth.js';

const POOL = address('Cp2nGCWWfqkUmPR3pPKoR376Fti8wuYRFrSWJZq1a9SA');
const TOKEN0 = address('METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta');
const TOKEN1 = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const RATE_MODEL = address('So11111111111111111111111111111111111111112');

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

function buildPair(): Uint8Array {
  const data = new Uint8Array(PAIR_ACCOUNT_SIZE);
  data.set(PAIR_DISCRIMINATOR, 0);
  writePubkey(data, 8, TOKEN0); // OFF_TOKEN0
  writePubkey(data, 40, TOKEN1); // OFF_TOKEN1
  writePubkey(data, 104, RATE_MODEL); // OFF_RATE_MODEL
  data[136] = 30; // swap_fee_bps (u16) = 30
  data[146] = 0; // option tag = None -> reserveBase 147
  writeU64LE(data, 147, 1_000_000n); // reserve0 > 0
  writeU64LE(data, 155, 2_000_000n); // reserve1 > 0
  data[147 + 160] = 6; // token0Decimals
  data[147 + 161] = 6; // token1Decimals
  return data;
}

function loaderFrom(map: Record<string, Uint8Array>): AccountLoader {
  return async (addr: Address) => map[addr] ?? null;
}

describe('omnipair Token-2022 self-drop', () => {
  it('REJECTS a pair whose token0Mint is a Token-2022 mint', async () => {
    const load = loaderFrom({
      [POOL]: buildPair(),
      [TOKEN0]: makeT22Mint(),
      [TOKEN1]: makeLegacyMint(),
    });
    await expect(fetchOmnipairPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it('does NOT drop a classic-legacy pair', async () => {
    const load = loaderFrom({
      [POOL]: buildPair(),
      [TOKEN0]: makeLegacyMint(),
      [TOKEN1]: makeLegacyMint(),
    });
    const cfg = await fetchOmnipairPoolConfig(load, POOL);
    expect(cfg.venue).toBe('omnipair');
    expect(cfg.token0Mint).toBe(TOKEN0);
  });

  it('does NOT drop when mint accounts are unreadable (falls back to legacy)', async () => {
    const load = loaderFrom({ [POOL]: buildPair() });
    const cfg = await fetchOmnipairPoolConfig(load, POOL);
    expect(cfg.venue).toBe('omnipair');
  });
});
