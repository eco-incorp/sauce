/**
 * CLMM/DLMM window batch-load regression.
 *
 * The tick/bin-array window resolvers (raydium-clmm / pancakeswap-clmm /
 * meteora-dlmm / invariant / crema) derive every candidate array PDA up front
 * and then USED to read them one at a time in a serial await loop — an outward
 * walk that flushed the coalescing loader once per array (one getMultipleAccounts
 * round PER array). They now register every load() synchronously so the
 * coalescing loader folds the whole window into ONE getMultipleAccounts, while
 * preserving the break-on-first-invalid readable-prefix contract exactly.
 *
 * This drives the two families with committed real mainnet fixtures
 * (raydium-clmm, meteora-dlmm) through a round-COUNTING coalescing loader and
 * asserts:
 *   1. the resolved boundary window is byte-identical (toMatchSnapshot — the
 *      snapshot is the canonical origin/main window, so a change to what/how the
 *      window is read would redden it), and
 *   2. the whole cold fetch resolves in <= 6 coalesced getMultipleAccounts
 *      rounds. Pre-flatten this was 10 (the serial per-array walk), so this
 *      assertion is failing-first for the serial regression.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import {
  coalescingAccountLoader,
  fetchMeteoraDlmmConfig,
  fetchRaydiumClmmConfig,
  LB_PAIR_DISCRIMINATOR,
  RAYDIUM_CLMM_POOL_DISCRIMINATOR,
} from '../../../src/svm/index.js';
import type { Address, BatchAccountLoader, LoadedAccount } from '../../../src/svm/index.js';
import { fixtureData, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';

/** The pool/pair fixture is the one whose data opens with the account discriminator. */
function findPool(fixtures: AccountFixture[], discriminator: readonly number[]): Address {
  const hit = fixtures.find((f) => discriminator.every((b, i) => fixtureData(f)[i] === b));
  if (!hit) throw new Error('no pool fixture matched the account discriminator');
  return address(hit.address);
}

/**
 * A coalescing AccountLoader over the fixtures that counts how many underlying
 * batch reads (getMultipleAccounts equivalents) actually happen — one per
 * microtask flush, i.e. one per dependency round.
 */
function roundCountingLoader(fixtures: AccountFixture[]): {
  load: ReturnType<typeof coalescingAccountLoader>;
  rounds: () => number;
} {
  let rounds = 0;
  const byAddress = new Map(fixtures.map((f) => [f.address, { data: fixtureData(f), owner: f.owner }]));
  const loadMany: BatchAccountLoader = async (addresses) => {
    rounds += 1;
    return addresses.map((a): LoadedAccount | null => {
      const hit = byAddress.get(a);
      return hit ? { data: new Uint8Array(hit.data), owner: address(hit.owner) } : null;
    });
  };
  return { load: coalescingAccountLoader(loadMany), rounds: () => rounds };
}

describe('raydium-clmm window batch-load', () => {
  let windows: unknown;
  let rounds = 0;
  beforeAll(async () => {
    const fixtures = loadFixtures(resolve(process.cwd(), 'test/svm/fixtures/raydium-clmm'));
    const pool = findPool(fixtures, RAYDIUM_CLMM_POOL_DISCRIMINATOR);
    const counting = roundCountingLoader(fixtures);
    const cfg = await fetchRaydiumClmmConfig(counting.load, pool);
    windows = cfg.windows;
    rounds = counting.rounds();
  });

  it('resolves a byte-identical boundary window in both directions', () => {
    expect(windows).toMatchSnapshot();
  });

  it('reads the whole window in coalesced rounds (<= 6 cold-fetch rounds; serial walk was 10)', () => {
    expect(rounds).toBeLessThanOrEqual(6);
  });
});

describe('meteora-dlmm window batch-load', () => {
  let windows: unknown;
  let rounds = 0;
  beforeAll(async () => {
    const fixtures = loadFixtures(resolve(process.cwd(), 'test/svm/fixtures/meteora-dlmm'));
    const pair = findPool(fixtures, LB_PAIR_DISCRIMINATOR);
    const counting = roundCountingLoader(fixtures);
    const cfg = await fetchMeteoraDlmmConfig(counting.load, pair);
    windows = cfg.windows;
    rounds = counting.rounds();
  });

  it('resolves a byte-identical bin window in both directions', () => {
    expect(windows).toMatchSnapshot();
  });

  it('reads the whole window in coalesced rounds (<= 6 cold-fetch rounds; serial walk was 10)', () => {
    expect(rounds).toBeLessThanOrEqual(6);
  });
});
