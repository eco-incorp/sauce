/**
 * orca-legacy-token-swap adapter units (no engine, no RPC): SwapV1 fixture
 * decode spot-checked against docs/svm-venues.md, referenceQuote pinned to
 * its worked examples, every fetch gate on a doctored fixture,
 * buildSwap byte/meta encoding, and emitQuote compiling as SauceScript with
 * the fee constants baked.
 */
import { resolve } from 'path';
import { address, getAddressCodec } from '@solana/kit';
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { orcaLegacyTokenSwap } from '../../../src/svm/venues/orca-legacy-token-swap/index.js';
import type { OrcaLegacyPoolConfig } from '../../../src/svm/venues/orca-legacy-token-swap/index.js';
import { readUintLE } from '../../../src/svm/index.js';
import type { AccountBytesMap, AccountLoader } from '../../../src/svm/index.js';
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from '../fixtures.js';

const POOL = address('EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U');
const SWAP_AUTHORITY = address('JU8kmKzDHF9sXWsnoznaFDFezLsE5uomX2JkRMbmsQP');
const VAULT_A = address('ANP74VNsHwSrq9uUSjiSNyNWvf6ZPrKTmE4gHoNd13Lg');
const VAULT_B = address('75HgnSvXbWKZBpZHveX68ZzAhDqMzNDS29X6BGLtxMo1');
const POOL_MINT = address('APDFRM3HMr8CAGXwKHiu2f5ePSpaiEJhaURwhsRrUUt9');
const FEE_ACCOUNT = address('8JnSiuvQq3BVuCU3n4DrSTw9chBSPvEMswrhtifVkr1o');
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const REF = `orca-legacy-token-swap:${POOL}`;

const fixtures = loadFixtures(resolve(process.cwd(), 'test/svm/fixtures/orca-legacy-token-swap'));
const load = fixtureLoader(fixtures);
const state = fixtureBytesMap(fixtures);
const poolFixture = fixtures.find((fixture) => fixture.address === POOL)!;

/** Loader serving the doctored pool bytes (other accounts untouched). */
const doctoredLoader = (mutate: (data: Uint8Array) => Uint8Array | null): AccountLoader => {
  return async (addr) => (addr === POOL ? mutate(fixtureData(poolFixture)) : load(addr));
};

/** State with a vault's SPL amount (u64 LE @64) overridden. */
const withVaultAmount = (base: AccountBytesMap, vault: string, amount: bigint): AccountBytesMap => {
  const data = new Uint8Array(base[vault]);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return { ...base, [vault]: data };
};

let cfg: OrcaLegacyPoolConfig;
beforeAll(async () => {
  cfg = await orcaLegacyTokenSwap.fetchPoolConfig(load, POOL);
});

describe('orca-legacy-token-swap adapter identity', () => {
  it('slug, kind and mainnet v2 program id match docs/svm-venues.md', () => {
    expect(orcaLegacyTokenSwap.slug).toBe('orca-legacy-token-swap');
    expect(orcaLegacyTokenSwap.kind).toBe('constant-product');
    expect(orcaLegacyTokenSwap.programId).toBe('9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP');
  });

  it('the fixture snapshot carries the reserves the pinned vectors were computed from', () => {
    expect(readUintLE(state[VAULT_A], 64, 8)).toBe(16016066895173n);
    expect(readUintLE(state[VAULT_B], 64, 8)).toBe(1306595296770n);
  });
});

describe('fetchPoolConfig', () => {
  it('decodes the SwapV1 fixture: vaults, mints and fee accounts at the documented offsets', () => {
    expect(cfg.venue).toBe('orca-legacy-token-swap');
    expect(cfg.pool).toBe(POOL);
    expect(cfg.vaultIn).toBe(VAULT_A); // token_a @35
    expect(cfg.vaultOut).toBe(VAULT_B); // token_b @67
    expect(cfg.poolMint).toBe(POOL_MINT); // pool_mint @99
    expect(cfg.inputMint).toBe(WSOL_MINT); // token_a_mint @131
    expect(cfg.outputMint).toBe(USDC_MINT); // token_b_mint @163
    expect(cfg.poolFeeAccount).toBe(FEE_ACCOUNT); // pool_fee_account @195
    expect(cfg.tokenProgram).toBe(TOKEN_PROGRAM); // token_program_id @3
  });

  it('decodes the fee fields: 25/10000 trade + 5/10000 owner trade', () => {
    expect(cfg.tradeFeeNumerator).toBe(25n); // @227
    expect(cfg.tradeFeeDenominator).toBe(10000n); // @235
    expect(cfg.ownerTradeFeeNumerator).toBe(5n); // @243
    expect(cfg.ownerTradeFeeDenominator).toBe(10000n); // @251
  });

  it('derives the swap authority from the stored bump (252), not find-style', () => {
    expect(cfg.bumpSeed).toBe(252); // bump_seed @2
    expect(cfg.swapAuthority).toBe(SWAP_AUTHORITY);
  });

  it('throws when the pool account does not exist', async () => {
    const missing = doctoredLoader(() => null);
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(missing, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} account not found`,
    );
  });

  it('gates on the 324-byte SwapVersion size', async () => {
    const truncated = doctoredLoader((data) => data.subarray(0, 323));
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(truncated, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} data must be 324 bytes (SwapVersion::SwapV1), got 323`,
    );
  });

  it('gates on version byte 1 (SwapV1)', async () => {
    const doctored = doctoredLoader((data) => ((data[0] = 2), data));
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(doctored, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} version must be 1 (SwapV1), got 2`,
    );
  });

  it('gates on is_initialized', async () => {
    const doctored = doctoredLoader((data) => ((data[1] = 0), data));
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(doctored, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} is not initialized`,
    );
  });

  it('gates on curve_type == 0 (Orca also ran stable-curve pools)', async () => {
    const doctored = doctoredLoader((data) => ((data[291] = 1), data));
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(doctored, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} curve_type must be 0 (constant product), got 1`,
    );
  });

  it('gates on a zero fee denominator under a nonzero numerator', async () => {
    // trade_fee_denominator @235 zeroed while the numerator stays 25.
    const doctored = doctoredLoader((data) => (data.fill(0, 235, 243), data));
    await expect(orcaLegacyTokenSwap.fetchPoolConfig(doctored, POOL)).rejects.toThrow(
      `orca-legacy-token-swap pool ${POOL} trade fee denominator is 0 with nonzero numerator 25`,
    );
  });
});

describe('quoteAccounts', () => {
  it('attaches exactly the two vaults, read-only, with resolved addresses', () => {
    expect(orcaLegacyTokenSwap.quoteAccounts(cfg)).toEqual([
      { ref: `${REF}:vault-in`, address: VAULT_A },
      { ref: `${REF}:vault-out`, address: VAULT_B },
    ]);
  });
});

describe('referenceQuote (docs/svm-venues.md formula, independent of emitQuote)', () => {
  it('reproduces the pinned worked example: 1 SOL -> 81330481 USDC raw', () => {
    // tradeFee 2500000, ownerFee 500000, netIn 997000000.
    expect(orcaLegacyTokenSwap.referenceQuote(cfg, state, 1_000_000_000n, 0n)).toBe(81330481n);
  });

  it('reproduces the 10 SOL vector: 812849439', () => {
    // tradeFee 25000000, ownerFee 5000000, netIn 9970000000.
    expect(orcaLegacyTokenSwap.referenceQuote(cfg, state, 10_000_000_000n, 0n)).toBe(812849439n);
  });

  it('reproduces the dust vector with the floor-min-1 fee rule: 1000 -> 81', () => {
    // tradeFee floor(1000*25/10000)=2; ownerFee floor(1000*5/10000)=0 -> min 1; netIn 997.
    expect(orcaLegacyTokenSwap.referenceQuote(cfg, state, 1000n, 0n)).toBe(81n);
  });

  it('throws when the min-1 fees consume the whole input', () => {
    // amountIn 2: tradeFee 1 + ownerFee 1 (both floored to 0, bumped to 1) -> netIn 0.
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, state, 2n, 0n)).toThrow(
      'orca-legacy-token-swap amountIn 2 is consumed entirely by fees',
    );
  });

  it('throws where the program would fail with a zero floor-quotient', () => {
    // rsOut 1: invariant == rsIn, newIn > rsIn, so floor(invariant/newIn) == 0.
    const doctored = withVaultAmount(state, VAULT_B, 1n);
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, doctored, 1_000_000_000n, 0n)).toThrow(
      'orca-legacy-token-swap swap fails on-chain (zero quotient)',
    );
  });

  it('throws where the ceiling rounds the output to zero', () => {
    // rsIn 1000, rsOut 2, netIn 500 (amountIn 502 pays 1+1 fees):
    // invariant 2000, newIn 1500, floor 1, ceil 2 -> amountOut 0.
    const doctored = withVaultAmount(withVaultAmount(state, VAULT_A, 1000n), VAULT_B, 2n);
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, doctored, 502n, 0n)).toThrow(
      'orca-legacy-token-swap swap fails on-chain (zero output)',
    );
  });

  it('throws when a quoted vault is missing from state', () => {
    const partial = { [VAULT_A as string]: state[VAULT_A] };
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, partial, 1000n, 0n)).toThrow(
      `orca-legacy-token-swap vault ${VAULT_B} missing from state`,
    );
  });

  it('rejects non-u64 inputs', () => {
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, state, 0n, 0n)).toThrow(
      'orca-legacy-token-swap amountIn must be a positive u64, got 0',
    );
    expect(() => orcaLegacyTokenSwap.referenceQuote(cfg, state, 1n << 64n, 0n)).toThrow(
      `orca-legacy-token-swap amountIn must be a positive u64, got ${1n << 64n}`,
    );
  });
});

describe('emitQuote', () => {
  it('bakes netIn and reads only the two vault amounts via svm.sload (Account model)', () => {
    // netIn = 1e9 - 2500000 - 500000 = 997000000; ceil((rIn*rOut)/(rIn+netIn))
    // spelled as (rIn*rOut + rIn + netIn - 1) / (rIn + netIn). Reads go through
    // main()'s positional `acc<k>` params (k = quoteAccounts() index): vault-in
    // is slot 0, vault-out slot 1.
    expect(orcaLegacyTokenSwap.emitQuote(cfg, 3, 1_000_000_000n)).toBe(
      [
        `const rIn3 = svm.sload(acc0, 64, 8).toLe();`,
        `const rOut3 = svm.sload(acc1, 64, 8).toLe();`,
        `const q3 = rOut3 - (rIn3 * rOut3 + rIn3 + 996999999) / (rIn3 + 997000000);`,
      ].join('\n'),
    );
  });

  it('compiles as SauceScript for target svm with the quoteAccounts slots in the manifest', () => {
    const fragment = orcaLegacyTokenSwap.emitQuote(cfg, 0, 1_000_000_000n);
    const accounts = orcaLegacyTokenSwap.quoteAccounts(cfg); // ordered [vault-in, vault-out]
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, 'q0'));
    expect(bytecode.length).toBeGreaterThan(0);
    // Manifest slots come back in quoteAccounts() (== main param) order: slot k
    // binds to quoteAccounts()[k].address (the RS analogue of accountPlan.metas).
    expect(manifest?.accounts).toEqual([
      { kind: 'slot', index: 0, name: 'acc0', requires: 'readonly' },
      { kind: 'slot', index: 1, name: 'acc1', requires: 'readonly' },
    ]);
    const boundAddresses = manifest?.accounts.map((meta) =>
      meta.kind === 'slot' ? accounts[meta.index]?.address : undefined,
    );
    expect(boundAddresses).toEqual([cfg.vaultIn, cfg.vaultOut]);
  });

  it('refuses to emit a quote whose fees consume the whole input', () => {
    expect(() => orcaLegacyTokenSwap.emitQuote(cfg, 0, 2n)).toThrow(
      'orca-legacy-token-swap amountIn 2 is consumed entirely by fees',
    );
  });
});

describe('Token-2022 stored token_program', () => {
  const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

  it('threads a Token-2022 program stored on the pool and quotes byte-identically', async () => {
    // The legacy spl-token-swap program stores ONE token_program_id (@3); this
    // adapter reads it rather than hardcoding legacy, so a pool created against
    // Token-2022 is threaded correctly. Set @3 to the Token-2022 program.
    const t22Bytes = new Uint8Array(getAddressCodec().encode(TOKEN_2022));
    const load2 = doctoredLoader((data) => {
      data.set(t22Bytes, 3);
      return data;
    });
    const t22cfg = await orcaLegacyTokenSwap.fetchPoolConfig(load2, POOL);
    expect(t22cfg.tokenProgram).toBe(TOKEN_2022);
    // The constant-product quote reads only raw vault balances (SPL amount @64,
    // identical on both token programs) → byte-identical to the legacy vector.
    expect(orcaLegacyTokenSwap.referenceQuote(t22cfg, state, 1_000_000_000n, 0n)).toBe(81330481n);
    // buildSwap threads the pool's stored program at account index 9.
    const { accounts } = orcaLegacyTokenSwap.buildSwap(
      t22cfg,
      { inAta: 'user-wsol', outAta: 'user-usdc', owner: 'payer' },
      1_000_000_000n,
    );
    expect(accounts[9]).toEqual({ ref: `${REF}:token-program`, address: TOKEN_2022 });
  });

  it('legacy control: the fixture pool still threads the legacy program', () => {
    expect(cfg.tokenProgram).toBe(TOKEN_PROGRAM);
    expect(orcaLegacyTokenSwap.referenceQuote(cfg, state, 1_000_000_000n, 0n)).toBe(81330481n);
  });
});

describe('buildSwap', () => {
  const user = { outAta: 'user-usdc', inAta: 'user-wsol', owner: 'payer' };

  it('encodes tag 1 + amount_in + minimum_amount_out 1 as 17 LE bytes', () => {
    const { programId, data } = orcaLegacyTokenSwap.buildSwap(cfg, user, 1_000_000_000n);
    expect(programId).toBe('9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP');
    // [tag=1] [amount_in 1e9 u64 LE] [minimum_amount_out 1 u64 LE]
    expect(Buffer.from(data).toString('hex')).toBe('01' + '00ca9a3b00000000' + '0100000000000000');
  });

  it('orders the ten swap accounts exactly as instruction.rs documents', () => {
    const { accounts } = orcaLegacyTokenSwap.buildSwap(cfg, user, 1_000_000_000n);
    expect(accounts).toEqual([
      { ref: `${REF}:pool`, address: POOL }, // 0 swap (pool state)
      { ref: `${REF}:authority`, address: SWAP_AUTHORITY }, // 1 swap authority
      { ref: 'payer', signer: true }, // 2 user transfer authority
      { ref: 'user-wsol', writable: true }, // 3 user source token acct
      { ref: `${REF}:vault-in`, address: VAULT_A, writable: true }, // 4 pool source vault
      { ref: `${REF}:vault-out`, address: VAULT_B, writable: true }, // 5 pool destination vault
      { ref: 'user-usdc', writable: true }, // 6 user destination token acct
      { ref: `${REF}:pool-mint`, address: POOL_MINT, writable: true }, // 7 pool mint
      { ref: `${REF}:fee-account`, address: FEE_ACCOUNT, writable: true }, // 8 pool fee account
      { ref: `${REF}:token-program`, address: TOKEN_PROGRAM }, // 9 token program (host fee acct omitted)
    ]);
  });

  it('rejects non-u64 amounts', () => {
    expect(() => orcaLegacyTokenSwap.buildSwap(cfg, user, 0n)).toThrow(
      'orca-legacy-token-swap amountIn must be a positive u64, got 0',
    );
    expect(() => orcaLegacyTokenSwap.buildSwap(cfg, user, 1n << 64n)).toThrow(
      `orca-legacy-token-swap amountIn must be a positive u64, got ${1n << 64n}`,
    );
  });
});
