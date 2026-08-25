/**
 * meteora-dbc venue adapter + ladder units, validated against REAL mainnet
 * pool state at three or more sizes per direction, cross-checked
 * lamport-for-lamport against the OFFICIAL `@meteora-ag/
 * dynamic-bonding-curve-sdk`'s `swapQuoteExactIn` (an independent,
 * Meteora-authored implementation) run on the SAME decoded bytes — not a
 * self-consistency check against our own math.
 *
 * Fixtures (test/svm/fixtures/meteora-dbc/, real mainnet dumps):
 *  - 5HXw3UDdd9n6aNsiPCNkB23JJBAZv3qSMf11oiJxL5z8 / config D5JsQBRqbTprBZCPGERxVjFeg1jn6ZECGhgShX36r3E6
 *    — static fee (cliff_fee_numerator = 20_000_000 = 2%, period_frequency
 *    = 0, dynamic fee disabled), single active segment (segIdx 0), live
 *    sqrt_price sits inside [sqrt_start_price, curve[0].sqrt_price].
 *  - 2kYZa4r6LD7qoBhbKQxFb3XmGkezD1AxSUccWFt7zcib / config AH3FPZicRqHcBCyUDsBD8oD8PiCAcpEWgtjfN1aqUAHu
 *    — an ARMED linear fee scheduler (period_frequency = 30, number_of_period
 *    = 10, reduction_factor = 4_000_000, cliff = 50_000_000) fully decayed
 *    to its floor (10_000_000 = 1%) at any `now` far past
 *    activation_point + 300s (pinned NOW below), PLUS a live dynamic
 *    (volatility) fee contributing +395_062 on top — both combined and
 *    exercised at once.
 *
 * The expected numbers below were computed by feeding the SAME decoded
 * account bytes into the official SDK's `swapQuoteExactIn` (see the PR
 * description / commit message for the exact script) — this is NOT a
 * regression pin invented from our own implementation.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { meteoraDbc } from '../../../src/svm/venues/meteora-dbc/index.js';
import type { MeteoraDbcPoolConfig } from '../../../src/svm/venues/meteora-dbc/index.js';
import { fixtureBytesMap, fixtureLoader, loadFixtures } from '../fixtures.js';

const FIXTURES = resolve(process.cwd(), 'test/svm/fixtures/meteora-dbc');
const STATIC_POOL = address('5HXw3UDdd9n6aNsiPCNkB23JJBAZv3qSMf11oiJxL5z8');
const SCHEDULED_POOL = address('2kYZa4r6LD7qoBhbKQxFb3XmGkezD1AxSUccWFt7zcib');
/** Safely far past both fixtures' activation_point + max schedule duration — deterministic forever. */
const NOW = 2_000_000_000n;

const fixtures = loadFixtures(FIXTURES);
const load = fixtureLoader(fixtures);
const state = fixtureBytesMap(fixtures);

const bi = (x: bigint): string => x.toString();

async function fetch(pool: ReturnType<typeof address>): Promise<MeteoraDbcPoolConfig> {
  return meteoraDbc.fetchPoolConfig(load, pool) as Promise<MeteoraDbcPoolConfig>;
}

describe('meteora-dbc: fetchPoolConfig decode', () => {
  it('static-fee pool: segIdx 0, single active segment, direction defaults quoteToBase', async () => {
    const cfg = await fetch(STATIC_POOL);
    expect(cfg.segIdx).toBe(0);
    expect(cfg.curveLength).toBe(2);
    expect(cfg.direction).toBe('quoteToBase');
    expect(cfg.quoteMint).toBe(address('So11111111111111111111111111111111111111112'));
  });

  it('scheduled+dynamic-fee pool: also segIdx 0', async () => {
    const cfg = await fetch(SCHEDULED_POOL);
    expect(cfg.segIdx).toBe(0);
  });
});

describe('meteora-dbc: v1 adapter referenceQuote matches the official SDK on real mainnet state', () => {
  it('quoteToBase (buying): 1 / 5 / 20 SOL, static 2% fee', async () => {
    const cfg = await fetch(STATIC_POOL);
    const expected: [bigint, bigint][] = [
      [1_000_000_000n, 18_643_953_491_788_332n],
      [5_000_000_000n, 86_357_294_065_213_210n],
      [20_000_000_000n, 270_699_732_078_262_432n],
    ];
    for (const [amountIn, out] of expected) {
      expect(bi(meteoraDbc.referenceQuote(cfg, state, amountIn, NOW))).toBe(bi(out));
    }
  });

  it('baseToQuote (selling): three sizes, static 2% fee', async () => {
    const cfg = await fetch(STATIC_POOL);
    const sellCfg: MeteoraDbcPoolConfig = { ...cfg, direction: 'baseToQuote' };
    const expected: [bigint, bigint][] = [
      [100_000_000_000_000n, 5_048_391n],
      [500_000_000_000_000n, 25_231_207n],
      [2_000_000_000_000_000n, 100_763_860n],
      [5_000_000_000_000_000n, 251_108_635n],
    ];
    for (const [amountIn, out] of expected) {
      expect(bi(meteoraDbc.referenceQuote(sellCfg, state, amountIn, NOW))).toBe(bi(out));
    }
  });

  it('quoteToBase with a LIVE decayed linear scheduler + a live dynamic (volatility) fee combined', async () => {
    const cfg = await fetch(SCHEDULED_POOL);
    const expected: [bigint, bigint][] = [
      [1_000_000_000n, 30_939_797_922_437n],
      [5_000_000_000n, 142_126_901_729_869n],
      [20_000_000_000n, 435_719_730_624_801n],
    ];
    for (const [amountIn, out] of expected) {
      expect(bi(meteoraDbc.referenceQuote(cfg, state, amountIn, NOW))).toBe(bi(out));
    }
  });
});

describe('meteora-dbc emitQuote — Account model (svm.sload) via RS', () => {
  // The Account-model migration: quoteAccounts() attaches [pool, config], so the
  // pool binds to main()'s acc0 and the config to acc1; every read is
  // svm.sload(acc<k>, off, w).toLe() (accountUint lowered to CAST_LE — .toLe() is
  // the exact endianness match) and block.timestamp becomes ctx.timestamp().
  it('reads pool (acc0) and config (acc1) via svm.sload().toLe(), never accountUint/block.timestamp', async () => {
    const cfg = await fetch(SCHEDULED_POOL);
    const fragment = meteoraDbc.emitQuote(cfg, 0, 1_000_000_000n);
    expect(fragment).not.toContain('accountUint(');
    expect(fragment).not.toContain('block.timestamp');
    expect(fragment).toContain('svm.sload(acc0,');
    expect(fragment).toContain('svm.sload(acc1,');
    expect(fragment).toContain('ctx.timestamp()');
  });

  it('compiles both pools/directions for the svm target, manifesting [pool, config] in param order', async () => {
    // SCHEDULED_POOL exercises the fee-scheduler + dynamic-fee nested-ifs — the
    // real venue program whose if-arm local liveness (#386) this validates.
    const staticCfg = await fetch(STATIC_POOL);
    const cfgs: MeteoraDbcPoolConfig[] = [
      staticCfg,
      await fetch(SCHEDULED_POOL),
      { ...staticCfg, direction: 'baseToQuote' },
    ];
    for (const cfg of cfgs) {
      const accounts = meteoraDbc.quoteAccounts(cfg);
      const { bytecode, manifest } = compileSvm(
        wrapQuoteMain(accounts.length, meteoraDbc.emitQuote(cfg, 0, 1_000_000_000n), 'q0'),
      );
      expect(bytecode.length).toBeGreaterThan(0);
      expect(manifest?.accounts).toEqual(
        accounts.map((_, k) => ({ kind: 'slot', index: k, name: `acc${k}`, requires: 'readonly' })),
      );
    }
  });
});
