/**
 * Raydium AMM v4 adapter units (no engine, no RPC): fetchPoolConfig decodes
 * the real mainnet fixture (SOL/USDC pool 58oQChx4..., snapshot 2026-07-04),
 * referenceQuote reproduces docs/svm-venues.md's pinned worked examples exactly,
 * every scope gate throws on a doctored fixture, buildSwap emits the
 * swap_base_in_v2 wire bytes + ordered metas, and emitQuote's fragment
 * compiles as target-'svm' SauceScript. Expected constants come from
 * docs/svm-venues.md (source-verified against raydium-io/raydium-amm and the
 * deployed mainnet binary), never from the adapter's own output.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { raydiumAmmV4 } from '../../../src/svm/venues/raydium-amm-v4/index.js';
import type { RaydiumAmmV4PoolConfig } from '../../../src/svm/venues/raydium-amm-v4/index.js';
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';

const POOL = address('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2');
const COIN_VAULT = address('DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz');
const PC_VAULT = address('HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz');
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const AMM_AUTHORITY = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

// Pinned fixture-snapshot constants from the docs/svm-venues.md worked
// example (2026-07-04 snapshot).
const COIN_VAULT_AMOUNT = 66_599_328_743_661n;
const SOL_IN = 1_000_000_000n; //  1 SOL  -> 81.386311 USDC (fee 2_500_000)
const SOL_TO_USDC_OUT = 81_386_311n;
const USDC_IN = 1_000_000n; //     1 USDC -> 0.012225534 SOL (fee 2_500)
const USDC_TO_SOL_OUT = 12_225_534n;

const FIXTURE_DIR = resolve(process.cwd(), 'test', 'svm', 'fixtures', 'raydium-amm-v4');
const fixtures = loadFixtures(FIXTURE_DIR);

const fetchConfig = (from: AccountFixture[] = fixtures): Promise<RaydiumAmmV4PoolConfig> =>
  raydiumAmmV4.fetchPoolConfig(fixtureLoader(from), POOL) as Promise<RaydiumAmmV4PoolConfig>;

/** Copy of the fixtures with `patch` applied to a fresh copy of one account's data. */
function doctored(target: Address, patch: (data: Uint8Array) => void): AccountFixture[] {
  return fixtures.map((fixture) => {
    if (fixture.address !== target) return fixture;
    const data = fixtureData(fixture);
    patch(data);
    return { ...fixture, base64Data: Buffer.from(data).toString('base64') };
  });
}

const writeU64 = (data: Uint8Array, offset: number, value: bigint): void => {
  new DataView(data.buffer, data.byteOffset).setBigUint64(offset, value, true);
};

const user = { inAta: 'user-in', outAta: 'user-out', owner: 'user-owner' };

describe('raydium-amm-v4 adapter identity', () => {
  it('declares the mainnet program id and constant-product kind', () => {
    expect(raydiumAmmV4.slug).toBe('raydium-amm-v4');
    expect(raydiumAmmV4.kind).toBe('constant-product');
    expect(raydiumAmmV4.programId).toBe('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  });

  it('rejects a config produced by another venue', () => {
    expect(() => raydiumAmmV4.quoteAccounts({ venue: 'other-venue', pool: POOL })).toThrow(
      "raydium-amm-v4 adapter got a config for venue 'other-venue'",
    );
  });
});

describe('raydium-amm-v4 fetchPoolConfig', () => {
  it('decodes the mainnet AmmInfo fixture (spot-checked against docs/svm-venues.md)', async () => {
    const cfg = await fetchConfig();

    expect(cfg.venue).toBe('raydium-amm-v4');
    expect(cfg.pool).toBe(POOL);
    expect(cfg.status).toBe(6n); // SwapOnly — the modern non-orderbook status
    expect(cfg.poolOpenTime).toBe(0n);
    expect(cfg.coinDecimals).toBe(9); // SOL
    expect(cfg.pcDecimals).toBe(6); // USDC
    expect(cfg.swapFeeNumerator).toBe(25n); // 25/10000 = 0.25%
    expect(cfg.swapFeeDenominator).toBe(10000n);
    expect(cfg.coinVault).toBe(COIN_VAULT);
    expect(cfg.pcVault).toBe(PC_VAULT);
    expect(cfg.coinMint).toBe(WSOL_MINT);
    expect(cfg.pcMint).toBe(USDC_MINT);
    expect(cfg.inputIsCoin).toBe(true);
  });

  it('throws when the pool account is missing', async () => {
    await expect(raydiumAmmV4.fetchPoolConfig(fixtureLoader(fixtures), address(TOKEN_PROGRAM))).rejects.toThrow(
      `raydium-amm-v4 pool account ${TOKEN_PROGRAM} not found`,
    );
  });

  it('throws when the pool data is not a 752-byte AmmInfo', async () => {
    const truncated = fixtures.map((fixture) =>
      fixture.address === POOL
        ? { ...fixture, base64Data: Buffer.from(fixtureData(fixture).slice(0, 751)).toString('base64') }
        : fixture,
    );
    await expect(fetchConfig(truncated)).rejects.toThrow(
      `raydium-amm-v4 pool ${POOL} data must be 752 bytes (AmmInfo), got 751`,
    );
  });

  it('gates out status 1 (Initialized), 2 (Disabled) and 5 (OrderBookOnly) pools', async () => {
    for (const status of [1n, 2n, 5n]) {
      const flipped = doctored(POOL, (data) => writeU64(data, 0, status));
      await expect(fetchConfig(flipped)).rejects.toThrow(
        `raydium-amm-v4 pool ${POOL} status ${status} is not quotable: only status 6 (SwapOnly) and 7 (WaitingTrade) swap without the orderbook`,
      );
    }
  });

  it('throws when a vault account is missing', async () => {
    const withoutCoinVault = fixtures.filter((fixture) => fixture.address !== COIN_VAULT);
    await expect(fetchConfig(withoutCoinVault)).rejects.toThrow(
      `raydium-amm-v4 coin vault account ${COIN_VAULT} not found`,
    );
  });

  it('throws when a vault is not a 165-byte SPL token account', async () => {
    const truncated = fixtures.map((fixture) =>
      fixture.address === PC_VAULT
        ? { ...fixture, base64Data: Buffer.from(fixtureData(fixture).slice(0, 100)).toString('base64') }
        : fixture,
    );
    await expect(fetchConfig(truncated)).rejects.toThrow(
      `raydium-amm-v4 pc vault ${PC_VAULT} must be a 165-byte SPL token account, got 100 bytes`,
    );
  });

  it('throws when a vault mint does not match the pool mint', async () => {
    const wrongMint = doctored(COIN_VAULT, (data) => {
      data[0] ^= 0xff; // corrupt the mint pubkey @0
    });
    await expect(fetchConfig(wrongMint)).rejects.toThrow(
      `does not match pool coin mint ${WSOL_MINT}`,
    );
  });

  it('gates a status-7 pool whose pool_open_time is in the future', async () => {
    const future = BigInt(Math.floor(Date.now() / 1000)) + 86_400n;
    const waiting = doctored(POOL, (data) => {
      writeU64(data, 0, 7n); // WaitingTrade
      writeU64(data, 224, future); // state_data.pool_open_time
    });
    await expect(fetchConfig(waiting)).rejects.toThrow(
      `raydium-amm-v4 pool ${POOL} is not open yet (pool_open_time ${future}, now `,
    );
  });

  it('accepts a status-7 pool once pool_open_time has passed', async () => {
    const open = doctored(POOL, (data) => {
      writeU64(data, 0, 7n);
      writeU64(data, 224, 1n);
    });
    const cfg = await fetchConfig(open);
    expect(cfg.status).toBe(7n);
    expect(cfg.poolOpenTime).toBe(1n);
  });
});

describe('raydium-amm-v4 referenceQuote (pinned worked examples)', () => {
  it('reproduces 1 SOL -> 81386311 (81.386311 USDC) exactly', async () => {
    const cfg = await fetchConfig();
    expect(raydiumAmmV4.referenceQuote(cfg, fixtureBytesMap(fixtures), SOL_IN, 0n)).toBe(SOL_TO_USDC_OUT);
  });

  it('reproduces 1 USDC -> 12225534 (0.012225534 SOL) exactly', async () => {
    const cfg = { ...(await fetchConfig()), inputIsCoin: false };
    expect(raydiumAmmV4.referenceQuote(cfg, fixtureBytesMap(fixtures), USDC_IN, 0n)).toBe(USDC_TO_SOL_OUT);
  });

  it('gates a status-7 pool on pool_open_time, then quotes identically once open', async () => {
    const openTime = 2_000_000_000n;
    // Fetch from an already-open status-7 snapshot (a future open_time is
    // gated at fetch); referenceQuote reads open_time from the LIVE state.
    const cfg = await fetchConfig(doctored(POOL, (data) => writeU64(data, 0, 7n)));
    const waiting = doctored(POOL, (data) => {
      writeU64(data, 0, 7n); // WaitingTrade
      writeU64(data, 224, openTime); // state_data.pool_open_time
    });
    const state = fixtureBytesMap(waiting);

    expect(() => raydiumAmmV4.referenceQuote(cfg, state, SOL_IN, openTime - 1n)).toThrow(
      `raydium-amm-v4 pool ${POOL} is not open yet: pool_open_time ${openTime}, now ${openTime - 1n}`,
    );
    // Status 7 changes nothing in the math — same pinned output at/after open.
    expect(raydiumAmmV4.referenceQuote(cfg, state, SOL_IN, openTime)).toBe(SOL_TO_USDC_OUT);
  });

  it('re-checks the status gate against live state (doctored after fetch)', async () => {
    const cfg = await fetchConfig();
    const disabled = fixtureBytesMap(doctored(POOL, (data) => writeU64(data, 0, 2n)));
    expect(() => raydiumAmmV4.referenceQuote(cfg, disabled, SOL_IN, 0n)).toThrow(
      `raydium-amm-v4 pool ${POOL} status 2 is not quotable`,
    );
  });

  it('throws on empty reserves (need_take_pnl_coin swallowing the whole vault)', async () => {
    const cfg = await fetchConfig();
    const drained = fixtureBytesMap(doctored(POOL, (data) => writeU64(data, 192, COIN_VAULT_AMOUNT)));
    expect(() => raydiumAmmV4.referenceQuote(cfg, drained, SOL_IN, 0n)).toThrow(
      `raydium-amm-v4 pool ${POOL} has empty reserves`,
    );
  });

  it('throws where the program would revert (amount_out floors to 0)', async () => {
    const cfg = await fetchConfig();
    // 10 lamports: fee ceils to 1, and 9 * pcReserve / coinReserve floors to 0.
    expect(() => raydiumAmmV4.referenceQuote(cfg, fixtureBytesMap(fixtures), 10n, 0n)).toThrow(
      `raydium-amm-v4 pool ${POOL} swap would revert on-chain (amount_out 0`,
    );
  });

  it('throws when the fee consumes the whole input', async () => {
    const cfg = await fetchConfig();
    expect(() => raydiumAmmV4.referenceQuote(cfg, fixtureBytesMap(fixtures), 1n, 0n)).toThrow(
      'raydium-amm-v4 amountIn 1 is consumed entirely by the swap fee',
    );
  });

  it('rejects non-positive and non-u64 amounts', async () => {
    const cfg = await fetchConfig();
    const state = fixtureBytesMap(fixtures);
    expect(() => raydiumAmmV4.referenceQuote(cfg, state, 0n, 0n)).toThrow(
      'raydium-amm-v4 amountIn must be positive, got 0',
    );
    expect(() => raydiumAmmV4.referenceQuote(cfg, state, 1n << 64n, 0n)).toThrow(
      `raydium-amm-v4 amountIn must fit u64, got ${1n << 64n}`,
    );
  });
});

describe('raydium-amm-v4 quoteAccounts + emitQuote', () => {
  it('attaches pool and both vaults read-only', async () => {
    const cfg = await fetchConfig();
    expect(raydiumAmmV4.quoteAccounts(cfg)).toEqual([
      { ref: `raydium-amm-v4:${POOL}`, address: POOL },
      { ref: `raydium-amm-v4:${POOL}:coin-vault`, address: COIN_VAULT },
      { ref: `raydium-amm-v4:${POOL}:pc-vault`, address: PC_VAULT },
    ]);
  });

  it('emits the coin->pc quote over live vault/need_take_pnl reads with the fee folded', async () => {
    const cfg = await fetchConfig();
    const fragment = raydiumAmmV4.emitQuote(cfg, 0, SOL_IN);

    // 1 SOL after the ceil-charged 25/10000 fee: 1_000_000_000 - 2_500_000.
    // Account model: acc0 = pool (AmmInfo, need_take_pnl_* @192/@200), acc1 =
    // coin vault, acc2 = pc vault (quoteAccounts() order).
    expect(fragment).toBe(
      [
        `const rayV4In0 = svm.sload(acc1, 64, 8).toLe() - svm.sload(acc0, 192, 8).toLe();`,
        `const rayV4Out0 = svm.sload(acc2, 64, 8).toLe() - svm.sload(acc0, 200, 8).toLe();`,
        `const q0 = rayV4Out0 * 997500000 / (rayV4In0 + 997500000);`,
      ].join('\n'),
    );
  });

  it('flips the vault and need_take_pnl reads for pc->coin', async () => {
    const cfg = { ...(await fetchConfig()), inputIsCoin: false };
    const fragment = raydiumAmmV4.emitQuote(cfg, 3, USDC_IN);

    expect(fragment).toBe(
      [
        `const rayV4In3 = svm.sload(acc2, 64, 8).toLe() - svm.sload(acc0, 200, 8).toLe();`,
        `const rayV4Out3 = svm.sload(acc1, 64, 8).toLe() - svm.sload(acc0, 192, 8).toLe();`,
        `const q3 = rayV4Out3 * 997500 / (rayV4In3 + 997500);`,
      ].join('\n'),
    );
  });

  it('emits syntactically valid target-svm SauceScript manifesting the quote accounts in param order', async () => {
    const cfg = await fetchConfig();
    const fragment = raydiumAmmV4.emitQuote(cfg, 0, SOL_IN);
    const accounts = raydiumAmmV4.quoteAccounts(cfg); // ordered [pool, coinVault, pcVault]
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, 'q0'));
    expect(bytecode.length).toBeGreaterThan(0);

    // Manifest slots come back in quoteAccounts() (== main param) order — the RS
    // analogue of accountPlan.metas: slot k binds to quoteAccounts()[k].address.
    expect(manifest?.accounts).toEqual([
      { kind: 'slot', index: 0, name: 'acc0' },
      { kind: 'slot', index: 1, name: 'acc1' },
      { kind: 'slot', index: 2, name: 'acc2' },
    ]);
    const boundAddresses = manifest?.accounts.map((meta) =>
      meta.kind === 'slot' ? accounts[meta.index]?.address : undefined,
    );
    expect(boundAddresses).toEqual([POOL, COIN_VAULT, PC_VAULT]);
  });

  it('throws when the fee consumes the whole input', async () => {
    const cfg = await fetchConfig();
    expect(() => raydiumAmmV4.emitQuote(cfg, 0, 1n)).toThrow(
      'raydium-amm-v4 amountIn 1 is consumed entirely by the 25/10000 swap fee',
    );
  });
});

describe('raydium-amm-v4 buildSwap (swap_base_in_v2)', () => {
  it('encodes discriminator 0x10 + amount_in u64 LE + minimum_amount_out 1', async () => {
    const cfg = await fetchConfig();
    const swap = raydiumAmmV4.buildSwap(cfg, user, SOL_IN);

    expect(swap.programId).toBe('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
    // 0x10 | 00ca9a3b00000000 (1_000_000_000 LE) | 0100000000000000 (min_out 1).
    expect(Buffer.from(swap.data).toString('hex')).toBe('1000ca9a3b000000000100000000000000');
  });

  it('orders the 8 account metas exactly as docs/svm-venues.md documents', async () => {
    const cfg = await fetchConfig();
    const swap = raydiumAmmV4.buildSwap(cfg, user, SOL_IN);

    expect(swap.accounts).toEqual([
      { ref: 'token-program', address: TOKEN_PROGRAM }, // 0 spl_token_program
      { ref: `raydium-amm-v4:${POOL}`, address: POOL, writable: true }, // 1 amm_pool
      { ref: 'raydium-amm-v4:authority', address: AMM_AUTHORITY }, // 2 amm_authority PDA
      { ref: `raydium-amm-v4:${POOL}:coin-vault`, address: COIN_VAULT, writable: true }, // 3 amm_coin_vault
      { ref: `raydium-amm-v4:${POOL}:pc-vault`, address: PC_VAULT, writable: true }, // 4 amm_pc_vault
      { ref: 'user-in', writable: true }, // 5 user_token_source
      { ref: 'user-out', writable: true }, // 6 user_token_destination
      { ref: 'user-owner', signer: true }, // 7 user_source_owner
    ]);
  });

  it('rejects non-positive and non-u64 amounts', async () => {
    const cfg = await fetchConfig();
    expect(() => raydiumAmmV4.buildSwap(cfg, user, 0n)).toThrow('raydium-amm-v4 amountIn must be positive, got 0');
    expect(() => raydiumAmmV4.buildSwap(cfg, user, 1n << 64n)).toThrow(
      `raydium-amm-v4 amountIn must fit u64, got ${1n << 64n}`,
    );
  });
});
