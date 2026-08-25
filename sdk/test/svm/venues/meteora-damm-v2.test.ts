/**
 * Meteora DAMM v2 adapter units (no engine, no RPC): fixture decode against
 * the docs/svm-venues.md field values, the pinned worked example (1 SOL -> 81.533661
 * USDC on pool 8Pm2... at the dumped state), every fetch gate on doctored
 * fixtures, swap instruction encoding, and SauceScript validity of the quote
 * fragment (compiled with target 'svm').
 *
 * referenceQuote expectations are pinned constants recomputed independently
 * from the docs/svm-venues.md quote recipe (sqrt-price step + rounding rules), not
 * from the adapter or its emitted SauceScript.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { meteoraDammV2 } from '../../../src/svm/venues/meteora-damm-v2/index.js';
import type { MeteoraDammV2PoolConfig } from '../../../src/svm/venues/meteora-damm-v2/index.js';
import type { AccountLoader, PoolConfig } from '../../../src/svm/index.js';
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from '../fixtures.js';

const POOL = address('8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie');
const COMPOUNDING_POOL = address('HybT1fLHfZDjQVnfBdFh9qT8kjPfb6wJCkKkoLZKqunm');
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VAULT_A = 'sx8hCMCauCdbZ7sVBGSJmH7b7JmtuN8d8YwYmBpuPLH';
const VAULT_B = '8S8HjmPZr8tNNEmMj5pcqS5RN73uF6DmcUDEDaoUQ1Ei';
const PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const POOL_AUTHORITY = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
const EVENT_AUTHORITY = '3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet';
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const ONE_SOL = 1_000_000_000n;
const HUNDRED_USDC = 100_000_000n;
// Fixture pool activation_point = 1754985927 with activation_type = 1 (unix).
const NOW = 1_780_000_000n;

const fixtures = loadFixtures(resolve(process.cwd(), 'test/svm/fixtures/meteora-damm-v2'));
const loader = fixtureLoader(fixtures);
const state = fixtureBytesMap(fixtures);
const poolFixture = fixtures.find((fixture) => fixture.address === POOL)!;

const fetchCfg = () => meteoraDammV2.fetchPoolConfig(loader, POOL);

function writeLE(data: Uint8Array, offset: number, width: number, value: bigint): void {
  for (let i = 0; i < width; i++) data[offset + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}

/** Fresh pool bytes with a mutation applied. */
function doctoredData(mutate: (data: Uint8Array) => void): Uint8Array {
  const data = fixtureData(poolFixture);
  mutate(data);
  return data;
}

function doctoredLoader(mutate: (data: Uint8Array) => void, extra: Record<string, Uint8Array> = {}): AccountLoader {
  const data = doctoredData(mutate);
  return async (addr) => (addr === POOL ? data : extra[addr] ?? null);
}

/** Token-2022 mint with a TransferFeeConfig extension (type 1, 108 bytes). */
function mintWithTransferFee(): Uint8Array {
  const data = new Uint8Array(166 + 4 + 108);
  data[165] = 1; // AccountType::Mint
  data[166] = 1; // extension type 1 = TransferFeeConfig (u16 LE)
  data[168] = 108; // extension length (u16 LE)
  return data;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('meteora-damm-v2 adapter identity', () => {
  it('carries the documented slug, kind and mainnet program id', () => {
    expect(meteoraDammV2.slug).toBe('meteora-damm-v2');
    expect(meteoraDammV2.kind).toBe('sqrt-price');
    expect(meteoraDammV2.programId).toBe(PROGRAM);
  });
});

describe('meteora-damm-v2 fetchPoolConfig', () => {
  it('decodes the WSOL/USDC fixture to the docs/svm-venues.md field values', async () => {
    const cfg = await fetchCfg();
    expect(cfg.venue).toBe('meteora-damm-v2');
    expect(cfg.pool).toBe(POOL);
    expect(cfg.direction).toBe('aToB');
    expect(cfg.tokenAMint).toBe(WSOL);
    expect(cfg.tokenBMint).toBe(USDC);
    expect(cfg.tokenAVault).toBe(VAULT_A);
    expect(cfg.tokenBVault).toBe(VAULT_B);
    expect(cfg.tokenAProgram).toBe(TOKENKEG);
    expect(cfg.tokenBProgram).toBe(TOKENKEG);
    expect(cfg.collectFeeMode).toBe(0);
    expect(cfg.cliffFeeNumerator).toBe(400_000n); // 0.04%
    expect(cfg.maxFeeNumerator).toBe(500_000_000n); // fee_version 0
    expect(cfg.dynamicFee).toBeNull();
    expect(cfg.activationPoint).toBe(1_754_985_927n);
    expect(cfg.activationType).toBe(1);
    expect(cfg.liquidity).toBe(127981592641713518779758772562077n);
    expect(cfg.sqrtPrice).toBe(5268463945783193101n);
    expect(cfg.sqrtMinPrice).toBe(4880549731789001291n);
    expect(cfg.sqrtMaxPrice).toBe(12236185739241331242n);
  });

  it('throws when the pool account is missing', async () => {
    await expect(meteoraDammV2.fetchPoolConfig(loader, address(POOL_AUTHORITY))).rejects.toThrow(
      `meteora-damm-v2 pool ${POOL_AUTHORITY} account not found`,
    );
  });

  it('gates on account size', async () => {
    const load: AccountLoader = async () => fixtureData(poolFixture).subarray(0, 1111);
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `meteora-damm-v2 pool ${POOL} account data is 1111 bytes, expected 1112`,
    );
  });

  it('gates on the Pool discriminator', async () => {
    const load = doctoredLoader((data) => {
      data[0] = 0;
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'is not a cp-amm Pool account (discriminator mismatch)',
    );
  });

  it('gates on pool_status != 0 (disabled)', async () => {
    const load = doctoredLoader((data) => {
      data[481] = 1;
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow('is disabled (pool_status=1)');
  });

  it('gates on collect_fee_mode == 2 via a doctored fixture', async () => {
    const load = doctoredLoader((data) => {
      data[484] = 2;
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'is a compounding pool (collect_fee_mode=2)',
    );
  });

  it('gates on the REAL compounding pool fixture (HybT...)', async () => {
    await expect(meteoraDammV2.fetchPoolConfig(loader, COMPOUNDING_POOL)).rejects.toThrow(
      `meteora-damm-v2 pool ${COMPOUNDING_POOL} is a compounding pool (collect_fee_mode=2); sqrt-price quoting does not apply`,
    );
  });

  it('gates on base_fee_mode >= 2 (rate limiter / market-cap scheduler)', async () => {
    const load = doctoredLoader((data) => {
      data[16] = 2;
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'base_fee_mode=2 (rate-limiter/market-cap scheduler) is amount-dependent and not supported',
    );
  });

  it('gates on an active fee time scheduler (period_frequency != 0)', async () => {
    const load = doctoredLoader((data) => writeLE(data, 24, 8, 3600n));
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'has an active fee time scheduler (period_frequency=3600)',
    );
  });

  it('gates on cliff_fee_numerator above the fee cap', async () => {
    const load = doctoredLoader((data) => writeLE(data, 8, 8, 600_000_000n));
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'cliff_fee_numerator 600000000 exceeds the fee cap 500000000',
    );
  });

  it('gates on a sqrt price band escaping the program band', async () => {
    const load = doctoredLoader((data) => writeLE(data, 440, 16, (1n << 128n) - 1n));
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'escapes the program band [4295048016, 79226673521066979257578248091]',
    );
  });

  it('gates on sqrt_price outside its own band', async () => {
    const load = doctoredLoader((data) => writeLE(data, 456, 16, 12236185739241331243n)); // sqrt_max + 1
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'sqrt_price 12236185739241331243 is outside its band',
    );
  });

  it('gates on zero liquidity', async () => {
    const load = doctoredLoader((data) => writeLE(data, 360, 16, 0n));
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow('has zero liquidity');
  });

  it('gates on a slot-typed nonzero activation_point', async () => {
    const load = doctoredLoader((data) => {
      data[480] = 0; // activation_type = slot; fixture activation_point stays 1754985927
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `meteora-damm-v2 pool ${POOL} has slot-based activation_point 1754985927 — slot-gated pools are out of scope`,
    );
  });

  it('accepts a slot-typed pool with activation_point 0', async () => {
    const load = doctoredLoader((data) => {
      data[480] = 0;
      writeLE(data, 472, 8, 0n);
    });
    const cfg = await meteoraDammV2.fetchPoolConfig(load, POOL);
    expect(cfg.activationType).toBe(0);
    expect(cfg.activationPoint).toBe(0n);
  });

  it('accepts a timestamp-typed pool whose activation point is in the future (gated in-fragment)', async () => {
    const load = doctoredLoader((data) => writeLE(data, 472, 8, NOW + 1n));
    const cfg = await meteoraDammV2.fetchPoolConfig(load, POOL);
    expect(cfg.activationType).toBe(1);
    expect(cfg.activationPoint).toBe(NOW + 1n);
  });

  it('gates on an unknown token program flag', async () => {
    const load = doctoredLoader((data) => {
      data[482] = 3;
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      'token_a_flag=3 is not a known token program flag',
    );
  });

  it('gates on a token-2022 mint that cannot be inspected', async () => {
    const load = doctoredLoader((data) => {
      data[483] = 1; // token_b -> Token-2022, mint not in the loader
    });
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token_b mint ${USDC} not found (required to inspect token-2022 extensions)`,
    );
  });

  it('gates on a token-2022 transfer-fee extension', async () => {
    const load = doctoredLoader(
      (data) => {
        data[482] = 1;
      },
      { [WSOL]: mintWithTransferFee() },
    );
    await expect(meteoraDammV2.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token_a mint ${WSOL} has a token-2022 transfer-fee extension`,
    );
  });

  it('accepts a token-2022 mint without extensions and selects the token-2022 program', async () => {
    const load = doctoredLoader(
      (data) => {
        data[482] = 1;
      },
      { [WSOL]: new Uint8Array(82) }, // base mint layout, no TLV
    );
    const cfg = await meteoraDammV2.fetchPoolConfig(load, POOL);
    expect(cfg.tokenAProgram).toBe(TOKEN_2022);
    expect(cfg.tokenBProgram).toBe(TOKENKEG);
  });
});

describe('meteora-damm-v2 referenceQuote', () => {
  it('reproduces the pinned worked example: 1 SOL -> 81.533661 USDC', async () => {
    const cfg = await fetchCfg();
    // docs/svm-venues.md: next_sqrt_price 5268247074206624762, gross 81566288,
    // output fee 32627 -> 81533661.
    expect(meteoraDammV2.referenceQuote(cfg, state, ONE_SOL, NOW)).toBe(81_533_661n);
  });

  it('reproduces the pinned bToA example: 100 USDC -> SOL (fee on output)', async () => {
    const cfg: MeteoraDammV2PoolConfig = { ...(await fetchCfg()), direction: 'bToA' };
    // docs/svm-venues.md pins gross 1225884357; collect_fee_mode 0 puts the 0.04%
    // fee on the output: 1225884357 - ceil(1225884357 * 400000 / 1e9)
    // = 1225884357 - 490354.
    expect(meteoraDammV2.referenceQuote(cfg, state, HUNDRED_USDC, NOW)).toBe(1_225_394_003n);
  });

  it('charges the fee on the INPUT for bToA when collect_fee_mode is 1 (OnlyB)', async () => {
    const doctored = doctoredData((data) => {
      data[484] = 1;
    });
    const cfg: MeteoraDammV2PoolConfig = {
      ...(await meteoraDammV2.fetchPoolConfig(async () => doctored, POOL)),
      direction: 'bToA',
    };
    // dIn = 1e8 - ceil(1e8 * 400000 / 1e9) = 99960000, then the curve output
    // is returned gross (no output fee): pinned 1225394028.
    expect(meteoraDammV2.referenceQuote(cfg, { [POOL]: doctored }, HUNDRED_USDC, NOW)).toBe(1_225_394_028n);
  });

  it('applies the stored dynamic fee on top of the base fee', async () => {
    const doctored = doctoredData((data) => {
      data[56] = 1; // dynamic_fee.initialized
      writeLE(data, 68, 4, 5000n); // variable_fee_control
      writeLE(data, 72, 2, 80n); // bin_step
      writeLE(data, 120, 16, 10000n); // volatility_accumulator
    });
    const cfg = await meteoraDammV2.fetchPoolConfig(async () => doctored, POOL);
    expect(cfg.dynamicFee).toEqual({ binStep: 80n, variableFeeControl: 5000n });
    // variable = ceil((10000 * 80)^2 * 5000 / 1e11) = 32000; total 432000;
    // 81566288 - ceil(81566288 * 432000 / 1e9) = 81566288 - 35237.
    expect(meteoraDammV2.referenceQuote(cfg, { [POOL]: doctored }, ONE_SOL, NOW)).toBe(81_531_051n);
  });

  it('clamps the total fee at max_fee_numerator', async () => {
    const doctored = doctoredData((data) => {
      data[56] = 1;
      writeLE(data, 68, 4, 4_000_000_000n);
      writeLE(data, 72, 2, 80n);
      writeLE(data, 120, 16, 10000n);
    });
    const cfg = await meteoraDammV2.fetchPoolConfig(async () => doctored, POOL);
    // base + variable >> 5e8 cap (fee_version 0): out = 81566288 - 81566288/2.
    expect(meteoraDammV2.referenceQuote(cfg, { [POOL]: doctored }, ONE_SOL, NOW)).toBe(40_783_144n);
  });

  it('quotes 0 when aToB input pushes past sqrt_min_price (mirrors the fragment clamp)', async () => {
    const cfg = await fetchCfg();
    expect(meteoraDammV2.referenceQuote(cfg, state, 10_000n * ONE_SOL, NOW)).toBe(0n);
  });

  it('quotes 0 when bToA input pushes past sqrt_max_price (mirrors the fragment clamp)', async () => {
    const cfg: MeteoraDammV2PoolConfig = { ...(await fetchCfg()), direction: 'bToA' };
    expect(meteoraDammV2.referenceQuote(cfg, state, (1n << 64n) - 1n, NOW)).toBe(0n);
  });

  it('throws before the activation point', async () => {
    const cfg = await fetchCfg();
    expect(() => meteoraDammV2.referenceQuote(cfg, state, ONE_SOL, 1_754_985_926n)).toThrow(
      `meteora-damm-v2 pool ${POOL} not activated (activation_point=1754985927, now=1754985926)`,
    );
  });

  it('re-runs the state gates on the live bytes', async () => {
    const cfg = await fetchCfg();
    const doctored = doctoredData((data) => {
      data[481] = 1;
    });
    expect(() => meteoraDammV2.referenceQuote(cfg, { [POOL]: doctored }, ONE_SOL, NOW)).toThrow(
      'is disabled (pool_status=1)',
    );
  });

  it('rejects a missing pool account and a non-u64 amountIn', async () => {
    const cfg = await fetchCfg();
    expect(() => meteoraDammV2.referenceQuote(cfg, {}, ONE_SOL, NOW)).toThrow(
      `meteora-damm-v2 pool ${POOL} missing from state`,
    );
    expect(() => meteoraDammV2.referenceQuote(cfg, state, 0n, NOW)).toThrow(
      'meteora-damm-v2 referenceQuote amountIn must be a positive u64, got 0',
    );
    expect(() => meteoraDammV2.referenceQuote(cfg, state, 1n << 64n, NOW)).toThrow(
      'meteora-damm-v2 referenceQuote amountIn must be a positive u64, got 18446744073709551616',
    );
  });
});

describe('meteora-damm-v2 quoteAccounts', () => {
  it('attaches the pool account only, read-only', async () => {
    const cfg = await fetchCfg();
    expect(meteoraDammV2.quoteAccounts(cfg)).toEqual([{ ref: POOL, address: POOL }]);
  });
});

describe('meteora-damm-v2 emitQuote — Account model (svm.sload) via RS', () => {
  // Account model: quoteAccounts() attaches the pool alone (slot 0 -> acc0), so
  // every read is `svm.sload(acc0, off, w).toLe()` over main()'s positional
  // params, compiled through the RUST compiler (the TS `accountUint`/accountPlan
  // form is gone). The emitted manifest binds slot k to quoteAccounts()[k].
  const compileFragment = (cfg: MeteoraDammV2PoolConfig, i: number, amountIn: bigint) => {
    const fragment = meteoraDammV2.emitQuote(cfg, i, amountIn);
    const accounts = meteoraDammV2.quoteAccounts(cfg);
    return { fragment, accounts, ...compileSvm(wrapQuoteMain(accounts.length, fragment, `q${i}`)) };
  };

  it('defines q<i> and reads pool state only via svm.sload on acc0', async () => {
    const cfg = await fetchCfg();
    const fragment = meteoraDammV2.emitQuote(cfg, 7, ONE_SOL);
    expect(fragment).toContain('let q7 =');
    expect(fragment).not.toContain('accountUint(');
    const reads = [...fragment.matchAll(/svm\.sload\((acc\d+),/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read).toBe('acc0');
    expect(fragment).toContain('.toLe();');
  });

  it('compiles for the svm target and manifests exactly the read-only pool (aToB)', async () => {
    const cfg = await fetchCfg();
    const { bytecode, manifest, accounts } = compileFragment(cfg, 0, ONE_SOL);
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual([{ kind: 'slot', index: 0, name: 'acc0', requires: 'readonly' }]);
    const bound = manifest?.accounts.map((m) => (m.kind === 'slot' ? accounts[m.index]?.address : undefined));
    expect(bound).toEqual([POOL]);
  });

  it('compiles for bToA with fee on output (collect_fee_mode 0)', async () => {
    const cfg: MeteoraDammV2PoolConfig = { ...(await fetchCfg()), direction: 'bToA' };
    const { fragment, bytecode } = compileFragment(cfg, 1, HUNDRED_USDC);
    expect(fragment).toContain('let q1 =');
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it('compiles for bToA with fee on input (collect_fee_mode 1)', async () => {
    const cfg: MeteoraDammV2PoolConfig = {
      ...(await fetchCfg()),
      direction: 'bToA',
      collectFeeMode: 1,
    };
    const { fragment, bytecode } = compileFragment(cfg, 2, HUNDRED_USDC);
    // Fee comes off the input before the curve; the curve output IS the quote.
    expect(fragment).toContain('let q2 = g2;');
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it('clamps a band-crossing quote to 0 instead of throwing, in both directions', async () => {
    const cfg = await fetchCfg();
    const aToB = meteoraDammV2.emitQuote(cfg, 4, ONE_SOL);
    expect(aToB).toContain(`if (n4 < ${cfg.sqrtMinPrice}) { q4 = 0 }`);
    expect(aToB).not.toContain('throw');
    const bToACfg: MeteoraDammV2PoolConfig = { ...cfg, direction: 'bToA' };
    const bToA = meteoraDammV2.emitQuote(bToACfg, 5, HUNDRED_USDC);
    expect(bToA).toContain(`if (n5 > ${cfg.sqrtMaxPrice}) { q5 = 0 }`);
    expect(bToA).not.toContain('throw');
  });

  it('emits the ctx.timestamp() activation gate for a timestamp-typed nonzero activation point', async () => {
    const cfg = await fetchCfg(); // fixture: activation_type 1, activation_point 1754985927
    const { fragment, bytecode } = compileFragment(cfg, 6, ONE_SOL);
    expect(fragment).toContain('if (ctx.timestamp() < 1754985927) { q6 = 0 }');
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it('omits the activation gate when activation_point is 0', async () => {
    const cfg: MeteoraDammV2PoolConfig = { ...(await fetchCfg()), activationPoint: 0n };
    expect(meteoraDammV2.emitQuote(cfg, 8, ONE_SOL)).not.toContain('ctx.timestamp()');
  });

  it('compiles the dynamic-fee variant with the capped fee', async () => {
    const cfg: MeteoraDammV2PoolConfig = {
      ...(await fetchCfg()),
      dynamicFee: { binStep: 80n, variableFeeControl: 5000n },
    };
    const { fragment, bytecode } = compileFragment(cfg, 3, ONE_SOL);
    expect(fragment).toContain('if (f3 > 500000000) { f3 = 500000000 }');
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it('rejects bad indices, amounts and foreign configs', async () => {
    const cfg = await fetchCfg();
    expect(() => meteoraDammV2.emitQuote(cfg, -1, ONE_SOL)).toThrow(
      'meteora-damm-v2 emitQuote index must be a non-negative integer, got -1',
    );
    expect(() => meteoraDammV2.emitQuote(cfg, 0, 0n)).toThrow(
      'meteora-damm-v2 emitQuote amountIn must be a positive u64, got 0',
    );
    expect(() => meteoraDammV2.emitQuote({ venue: 'raydium-cp-swap', pool: POOL } as PoolConfig, 0, ONE_SOL)).toThrow(
      "meteora-damm-v2 adapter got a config for venue 'raydium-cp-swap'",
    );
  });
});

describe('meteora-damm-v2 buildSwap', () => {
  const user = { inAta: 'user-in', outAta: 'user-out', owner: 'user-owner' };

  it('encodes swap as discriminator || amount_in u64 LE || min_out=1 u64 LE', async () => {
    const cfg = await fetchCfg();
    const swap = meteoraDammV2.buildSwap(cfg, user, ONE_SOL);
    expect(swap.programId).toBe(PROGRAM);
    expect(swap.data).toHaveLength(24);
    // sha256('global:swap')[0..8] = [248,198,158,145,225,117,135,200],
    // then 1e9 LE, then 1 LE.
    expect(hex(swap.data)).toBe('f8c69e91e17587c8' + '00ca9a3b00000000' + '0100000000000000');
  });

  it('orders the account metas exactly as the docs/svm-venues.md swap list', async () => {
    const cfg = await fetchCfg();
    const swap = meteoraDammV2.buildSwap(cfg, user, ONE_SOL);
    expect(swap.accounts).toEqual([
      { ref: POOL_AUTHORITY, address: POOL_AUTHORITY },
      { ref: POOL, address: POOL, writable: true },
      { ref: 'user-in', writable: true },
      { ref: 'user-out', writable: true },
      { ref: VAULT_A, address: VAULT_A, writable: true },
      { ref: VAULT_B, address: VAULT_B, writable: true },
      { ref: WSOL, address: WSOL },
      { ref: USDC, address: USDC },
      { ref: 'user-owner', signer: true },
      { ref: TOKENKEG, address: TOKENKEG },
      { ref: TOKENKEG, address: TOKENKEG },
      { ref: PROGRAM, address: PROGRAM }, // referral none-placeholder
      { ref: EVENT_AUTHORITY, address: EVENT_AUTHORITY },
      { ref: PROGRAM, address: PROGRAM },
    ]);
  });

  it('rejects a non-u64 amountIn', async () => {
    const cfg = await fetchCfg();
    expect(() => meteoraDammV2.buildSwap(cfg, user, 0n)).toThrow(
      'meteora-damm-v2 buildSwap amountIn must be a positive u64, got 0',
    );
  });
});
