/**
 * carrot Token-2022 threading (no engine, no RPC).
 *
 * carrot is a NAV-priced vault ladder whose per-mint token program is threaded
 * from the curated CARROT_TOKEN_2022_MINTS set (see the module header's TOKEN
 * PROGRAM note — the shares mint CRT and the pyUSD basket asset are Token-2022;
 * USDC/USDT are legacy). This suite proves the Token-2022 mints are recognized
 * (so downstream uses the Token-2022 program → they ROUTE) and that a direction
 * pairs a basket asset against the Token-2022 shares mint correctly.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { CARROT_TOKEN_2022_MINTS, CRT_MINT, carrotMints } from '../../../src/svm/venues/carrot/index.js';
import type { CarrotPoolConfig, CarrotAssetSnapshot } from '../../../src/svm/venues/carrot/index.js';

const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const PYUSD = address('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');

function asset(assetId: number, mint: Address): CarrotAssetSnapshot {
  return { assetId, mint, decimals: 6, ata: mint, oracle: mint, priceOffset: 73, scale: 10_000n, priceSnapshot: 1n, publishTime: 0n };
}

describe('carrot Token-2022 threading', () => {
  it('classifies CRT (shares) and pyUSD as Token-2022 (they route with the T22 program)', () => {
    expect(CARROT_TOKEN_2022_MINTS.has(CRT_MINT)).toBe(true);
    expect(CARROT_TOKEN_2022_MINTS.has(PYUSD)).toBe(true);
  });

  it('keeps USDC / USDT legacy (not misclassified as Token-2022)', () => {
    expect(CARROT_TOKEN_2022_MINTS.has(USDC)).toBe(false);
    expect(CARROT_TOKEN_2022_MINTS.has(USDT)).toBe(false);
  });

  it('pairs a basket asset against the Token-2022 shares mint per direction', () => {
    const base: CarrotPoolConfig = {
      venue: 'carrot',
      pool: CRT_MINT,
      sharesMint: CRT_MINT,
      redemptionFeeBps: 0n,
      assets: [asset(0, USDC)],
      direction: 'issue:0',
    };
    // issue: asset in, T22 shares out.
    expect(carrotMints(base)).toEqual({ inMint: USDC, outMint: CRT_MINT });
    // redeem: T22 shares in, asset out.
    const redeem: CarrotPoolConfig = { ...base, direction: 'redeem:0' };
    expect(carrotMints(redeem)).toEqual({ inMint: CRT_MINT, outMint: USDC });
  });
});
