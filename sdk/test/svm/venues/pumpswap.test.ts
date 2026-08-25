/**
 * Pumpswap adapter units (no engine): fixture decoding against the
 * docs/svm-venues.md byte offsets, the mainnet-sim-verified worked examples
 * reproduced exactly, every fetch gate on doctored fixtures, buy/sell
 * instruction encoding + ordered account metas, and emitted-fragment
 * compilation.
 *
 * Pinned constants come from the pumpswap section of docs/svm-venues.md
 * (quote recipe verified against BuyEvent/SellEvent mainnet simulations) and
 * from the recorded simulation events themselves
 * (protocol_fee_recipient_token_account); the fixture-snapshot quotes were
 * recomputed from the documented formulas outside this package.
 */
import { join } from 'path';
import type { Address } from '@solana/kit';
import { compileSvm, wrapQuoteMain } from '../rs-compile.js';
import { pumpswapAdapter, USER_VOLUME_ACCUMULATOR_REF } from '../../../src/svm/venues/pumpswap/index.js';
import type { PumpswapPoolConfig } from '../../../src/svm/venues/pumpswap/index.js';
import type { AccountBytesMap, VenueAccount } from '../../../src/svm/venues/types.js';
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';

const addr = (value: string): Address => value as Address;

// PUMP/USDC pool (docs/svm-venues.md primary fixture — non-canonical, flat fees).
const POOL = addr('2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd');
const PUMP_MINT = addr('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn');
const USDC_MINT = addr('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BASE_VAULT = addr('8TqK4PL3x7zWR2dNinr1LMi8Uf4vTRSFE2Ev1yYW9bhC');
const QUOTE_VAULT = addr('68Vdm7mQJ7RBxWioLVEUXbeTTpTtyiR1CL9vLRxmdr8t');
// Canonical bonding-curve migration pool (docs/svm-venues.md canonical fixture).
const CANONICAL_POOL = addr('GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J');
const CANONICAL_QUOTE_VAULT = addr('43DVcZR4kQFjh4Xm2i3DcneRxNjZp7HMud8yDrJWrDr8');

const AMM_PROGRAM = addr('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const FEE_PROGRAM = addr('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const GLOBAL_CONFIG = addr('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
const FEE_CONFIG = addr('5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx');
const EVENT_AUTHORITY = addr('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR');
const GLOBAL_VOLUME_ACCUMULATOR = addr('C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw');
const SYSTEM_PROGRAM = addr('11111111111111111111111111111111');
const ASSOCIATED_TOKEN_PROGRAM = addr('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKENKEG = addr('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = addr('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// GlobalConfig recipients[0] / buyback_fee_recipients[0] (docs/svm-venues.md offsets 57/643).
const PROTOCOL_FEE_RECIPIENT = addr('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV');
const BUYBACK_FEE_RECIPIENT = addr('5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD');
// ATA(62qc..., USDC) — echoed by the recorded mainnet BuyEvent simulation.
const PROTOCOL_FEE_RECIPIENT_USDC_ATA = addr('BqcWAXkSdknwQxvqXYVGKtttZynYNHACPVJmTaoqgfv8');
const CREATOR_VAULT_AUTHORITY_DEFAULT = addr('8N3GDaZ2iwN65oxVatKTLPNooAVUJTbfiVJ1ahyqwjSk');
const CREATOR_VAULT_ATA_DEFAULT_USDC = addr('3F3yggKdzZvMFCs1MrpR6SG3VYdhZ5VQngz15rTVabfG');
const BUYBACK_USDC_ATA = addr('6oCkp6gpyjxVTeL6ahMYcekN2x2pzt1KY8g2LqemaTNE');
// Canonical pool derivations (coin_creator 5L5k..., quote WSOL).
const CANONICAL_COIN_CREATOR = addr('5L5k7gtNLbeXdzpvNrFshg1E1id1ceUDfc6vPUTxp98q');
const CANONICAL_POOL_V2 = addr('4Jjna3h73QbgmdqwnV5NJxjCidKWB7Q26jeuj9jtFetC');

// buy_exact_quote_in verified example (docs/svm-venues.md): reserves at simulation time.
const BUY_EXAMPLE = { base: 4154251682177570n, quote: 6515063678232n, spend: 1_000_000_000n, out: 635633459193n };
// sell verified example.
const SELL_EXAMPLE = { base: 4153516048718377n, quote: 6516220452584n, baseIn: 50_000_000_000n, out: 78205951n };
// Quotes over the untouched fixture snapshot (vault amounts 4144782727340999 /
// 6530283775547), recomputed from the documented formulas outside this package.
const FIXTURE_BUY_OUT = 632706768908n;
const FIXTURE_SELL_OUT = 78539874n;

const FIXTURE_DIR = join(process.cwd(), 'test', 'svm', 'fixtures', 'pumpswap');
const fixtures = loadFixtures(FIXTURE_DIR);
const byAddress = new Map(fixtures.map((fixture) => [fixture.address, fixture]));

function withFixture(target: Address, transform: (data: Uint8Array) => Uint8Array): AccountFixture[] {
  expect(byAddress.has(target)).toBe(true);
  return fixtures.map((fixture) =>
    fixture.address === target
      ? { ...fixture, base64Data: Buffer.from(transform(fixtureData(fixture))).toString('base64') }
      : fixture,
  );
}

const without = (target: Address): AccountFixture[] => fixtures.filter((fixture) => fixture.address !== target);

function setU64LE(data: Uint8Array, offset: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[offset + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}

const u64LEBytes = (value: bigint): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) bytes.push(Number((value >> BigInt(8 * i)) & 0xffn));
  return bytes;
};

async function fetchConfig(pool: Address, from: AccountFixture[] = fixtures): Promise<PumpswapPoolConfig> {
  return pumpswapAdapter.fetchPoolConfig(fixtureLoader(from), pool);
}

/** Fixture state with the pool vault amounts overwritten to a verified example's reserves. */
function stateWithReserves(base: bigint, quote: bigint): AccountBytesMap {
  const state = fixtureBytesMap(fixtures);
  setU64LE(state[BASE_VAULT], 64, base);
  setU64LE(state[QUOTE_VAULT], 64, quote);
  return state;
}

const user = { outAta: 'user-pump-ata', inAta: 'user-usdc-ata', owner: 'user' };

describe('pumpswap adapter', () => {
  it('identifies itself', () => {
    expect(pumpswapAdapter.slug).toBe('pumpswap');
    expect(pumpswapAdapter.kind).toBe('constant-product');
    expect(pumpswapAdapter.programId).toBe(AMM_PROGRAM);
  });
});

describe('fetchPoolConfig', () => {
  it('decodes the PUMP/USDC pool fixture per the docs/svm-venues.md offsets', async () => {
    const cfg = await fetchConfig(POOL);
    expect(cfg.venue).toBe('pumpswap');
    expect(cfg.pool).toBe(POOL);
    expect(cfg.direction).toBe('quoteToBase');
    expect(cfg.baseMint).toBe(PUMP_MINT); // offset 43
    expect(cfg.quoteMint).toBe(USDC_MINT); // offset 75
    expect(cfg.baseVault).toBe(BASE_VAULT); // offset 139
    expect(cfg.quoteVault).toBe(QUOTE_VAULT); // offset 171
    expect(cfg.coinCreator).toBe(SYSTEM_PROGRAM); // offset 211, Pubkey::default
    expect(cfg.canonical).toBe(false);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022); // PUMP is token-2022
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
    expect(cfg.disableFlags).toBe(0);
  });

  it('selects FeeConfig.flat_fees for the non-canonical pool, creator fee zeroed', async () => {
    const cfg = await fetchConfig(POOL);
    expect(cfg.lpFeeBps).toBe(25n);
    expect(cfg.protocolFeeBps).toBe(5n);
    expect(cfg.creatorFeeBps).toBe(0n);
  });

  it('resolves the swap-side addresses (protocol ATA matches the recorded BuyEvent)', async () => {
    const cfg = await fetchConfig(POOL);
    expect(cfg.protocolFeeRecipient).toBe(PROTOCOL_FEE_RECIPIENT);
    expect(cfg.protocolFeeRecipientTokenAccount).toBe(PROTOCOL_FEE_RECIPIENT_USDC_ATA);
    expect(cfg.coinCreatorVaultAuthority).toBe(CREATOR_VAULT_AUTHORITY_DEFAULT);
    expect(cfg.coinCreatorVaultAta).toBe(CREATOR_VAULT_ATA_DEFAULT_USDC);
    expect(cfg.poolV2).toBeUndefined(); // coin_creator unset
    expect(cfg.buybackFeeRecipient).toBe(BUYBACK_FEE_RECIPIENT);
    expect(cfg.buybackFeeRecipientTokenAccount).toBe(BUYBACK_USDC_ATA);
  });

  it('detects the canonical pool and picks the market-cap fee tier', async () => {
    const cfg = await fetchConfig(CANONICAL_POOL);
    expect(cfg.canonical).toBe(true);
    expect(cfg.coinCreator).toBe(CANONICAL_COIN_CREATOR);
    // Fixture market cap is 220432822880 lamports (~220 SOL), below the
    // 420-SOL tier-1 threshold -> tier 0 fees 2/93/30 (2026-07 tiers in
    // docs/svm-venues.md, verified on-chain for this pool).
    expect(cfg.lpFeeBps).toBe(2n);
    expect(cfg.protocolFeeBps).toBe(93n);
    expect(cfg.creatorFeeBps).toBe(30n); // coin_creator set -> kept
    expect(cfg.poolV2).toBe(CANONICAL_POOL_V2);
  });

  it('tier scan takes the highest tier whose threshold the market cap clears', async () => {
    // Quote reserve doctored to 300 SOL -> market cap 490204326783, strictly
    // between tier1 (420e9) and tier2 (1470e9) thresholds -> 20/5/95.
    const doctored = withFixture(CANONICAL_QUOTE_VAULT, (data) => {
      setU64LE(data, 64, 300_000_000_000n);
      return data;
    });
    const cfg = await fetchConfig(CANONICAL_POOL, doctored);
    expect(cfg.lpFeeBps).toBe(20n);
    expect(cfg.protocolFeeBps).toBe(5n);
    expect(cfg.creatorFeeBps).toBe(95n);
  });
});

describe('fetchPoolConfig gates', () => {
  it('throws when the pool account is missing', async () => {
    await expect(fetchConfig(POOL, without(POOL))).rejects.toThrow(`pumpswap pool ${POOL} not found`);
  });

  it('throws on a foreign pool discriminator', async () => {
    const doctored = withFixture(POOL, (data) => {
      data[0] ^= 0xff;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap pool ${POOL} discriminator mismatch (not a pump amm Pool account)`,
    );
  });

  it('throws on truncated pool data', async () => {
    const doctored = withFixture(POOL, (data) => data.slice(0, 200));
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap pool ${POOL} data is 200 bytes, expected at least 211`,
    );
  });

  it('throws on a mayhem-mode pool', async () => {
    const doctored = withFixture(POOL, (data) => {
      data[243] = 1;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap pool ${POOL} gate: is_mayhem_mode is set (mayhem fee routing is unverified)`,
    );
  });

  it('throws on a cashback coin', async () => {
    const doctored = withFixture(POOL, (data) => {
      data[244] = 1;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap pool ${POOL} gate: is_cashback_coin is set (cashback swaps need user-derived remaining accounts)`,
    );
  });

  it('does not throw when buys are disabled in GlobalConfig — gate is deferred to buildSwap (disable_flags bit 3)', async () => {
    // fetchPoolConfig always returns direction 'quoteToBase' before the caller has resolved
    // a real direction, so gating a disabled buy here would drop a pool that's still a valid
    // sell venue — the check happens in buildSwap instead (see the 'rejects ... disabled sells'
    // buildSwap test for the mirrored sell-side gate).
    const doctored = withFixture(GLOBAL_CONFIG, (data) => {
      data[56] = 1 << 3;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).resolves.toMatchObject({ disableFlags: 1 << 3 });
  });

  it('throws on a foreign GlobalConfig discriminator', async () => {
    const doctored = withFixture(GLOBAL_CONFIG, (data) => {
      data[0] ^= 0xff;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap global config ${GLOBAL_CONFIG} discriminator mismatch`,
    );
  });

  it('throws on a foreign FeeConfig discriminator', async () => {
    const doctored = withFixture(FEE_CONFIG, (data) => {
      data[0] ^= 0xff;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap fee config ${FEE_CONFIG} discriminator mismatch`,
    );
  });

  it('throws on a base mint carrying a token-2022 TransferFeeConfig extension', async () => {
    // Rewrite the first TLV extension type (TransferHook, 14) to 1.
    const doctored = withFixture(PUMP_MINT, (data) => {
      data[166] = 1;
      data[167] = 0;
      return data;
    });
    await expect(fetchConfig(POOL, doctored)).rejects.toThrow(
      `pumpswap gate: mint ${PUMP_MINT} carries a token-2022 TransferFeeConfig extension (vault deltas would not match user amounts)`,
    );
  });

  it('throws when a pool vault is missing', async () => {
    await expect(fetchConfig(POOL, without(QUOTE_VAULT))).rejects.toThrow(
      `pumpswap quote vault ${QUOTE_VAULT} not found`,
    );
  });
});

describe('referenceQuote', () => {
  it('reproduces the verified buy_exact_quote_in example exactly', async () => {
    const cfg = await fetchConfig(POOL);
    const state = stateWithReserves(BUY_EXAMPLE.base, BUY_EXAMPLE.quote);
    expect(pumpswapAdapter.referenceQuote(cfg, state, BUY_EXAMPLE.spend, 0n)).toBe(BUY_EXAMPLE.out);
  });

  it('reproduces the verified sell example exactly', async () => {
    const cfg = await fetchConfig(POOL);
    const sellCfg: PumpswapPoolConfig = { ...cfg, direction: 'baseToQuote' };
    const state = stateWithReserves(SELL_EXAMPLE.base, SELL_EXAMPLE.quote);
    expect(pumpswapAdapter.referenceQuote(sellCfg, state, SELL_EXAMPLE.baseIn, 0n)).toBe(SELL_EXAMPLE.out);
  });

  it('quotes the untouched fixture snapshot in both directions', async () => {
    const cfg = await fetchConfig(POOL);
    const state = fixtureBytesMap(fixtures);
    expect(pumpswapAdapter.referenceQuote(cfg, state, 1_000_000_000n, 0n)).toBe(FIXTURE_BUY_OUT);
    const sellCfg: PumpswapPoolConfig = { ...cfg, direction: 'baseToQuote' };
    expect(pumpswapAdapter.referenceQuote(sellCfg, state, 50_000_000_000n, 0n)).toBe(FIXTURE_SELL_OUT);
  });

  it('guards the unverified tiny-input edge (effective quote input below 2)', async () => {
    const cfg = await fetchConfig(POOL);
    const state = fixtureBytesMap(fixtures);
    expect(() => pumpswapAdapter.referenceQuote(cfg, state, 1n, 0n)).toThrow(
      'pumpswap quote amountIn 1 is too small (effective quote input below 2)',
    );
  });

  it('rejects non-positive amounts and missing vault state', async () => {
    const cfg = await fetchConfig(POOL);
    const state = fixtureBytesMap(fixtures);
    expect(() => pumpswapAdapter.referenceQuote(cfg, state, 0n, 0n)).toThrow(
      'pumpswap amountIn must be a positive u64, got 0',
    );
    delete state[BASE_VAULT];
    expect(() => pumpswapAdapter.referenceQuote(cfg, state, 1_000_000_000n, 0n)).toThrow(
      `pumpswap referenceQuote is missing base vault ${BASE_VAULT} in state`,
    );
  });
});

describe('quoteAccounts', () => {
  it('attaches the two vaults read-only', async () => {
    const cfg = await fetchConfig(POOL);
    expect(pumpswapAdapter.quoteAccounts(cfg)).toEqual([
      { ref: BASE_VAULT, address: BASE_VAULT },
      { ref: QUOTE_VAULT, address: QUOTE_VAULT },
    ]);
  });
});

describe('emitQuote', () => {
  it('folds the buy fee arithmetic off-chain (effQ - 1 = 997008971 for 1e9 at 25/5/0)', async () => {
    const cfg = await fetchConfig(POOL);
    const fragment = pumpswapAdapter.emitQuote(cfg, 0, 1_000_000_000n);
    // Account model: reads go through main()'s positional `acc<k>` params (k = quoteAccounts()
    // index), not `accountUint("<address>", …)` string refs; base vault is slot 0, quote vault slot 1.
    expect(fragment).toContain('const psBase0 = svm.sload(acc0, 64, 8).toLe();');
    expect(fragment).toContain('const psQuote0 = svm.sload(acc1, 64, 8).toLe();');
    expect(fragment).toContain('const q0 = Math.mulDiv(psBase0, 997008971, psQuote0 + 997008971);');
  });

  it('buy fragment compiles for the svm target and manifests the two vaults in quoteAccounts order', async () => {
    const cfg = await fetchConfig(POOL);
    const fragment = pumpswapAdapter.emitQuote(cfg, 0, 1_000_000_000n);
    const accounts = pumpswapAdapter.quoteAccounts(cfg); // ordered [baseVault, quoteVault]
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, 'q0'));
    expect(bytecode.length).toBeGreaterThan(0);
    // The manifest slots come back in quoteAccounts() (== main param) order — the RS analogue of
    // the old accountPlan.metas: slot k binds to quoteAccounts()[k].address.
    expect(manifest?.accounts).toEqual([
      { kind: 'slot', index: 0, name: 'acc0', requires: 'readonly' },
      { kind: 'slot', index: 1, name: 'acc1', requires: 'readonly' },
    ]);
    const boundAddresses = manifest?.accounts.map((meta) =>
      meta.kind === 'slot' ? accounts[meta.index]?.address : undefined,
    );
    expect(boundAddresses).toEqual([BASE_VAULT, QUOTE_VAULT]);
  });

  it('sell fragment ceil-rounds each non-zero fee component on the output', async () => {
    const cfg = await fetchConfig(POOL);
    const sellCfg: PumpswapPoolConfig = { ...cfg, direction: 'baseToQuote' };
    const fragment = pumpswapAdapter.emitQuote(sellCfg, 3, 50_000_000_000n);
    expect(fragment).toContain('const psOut3 = Math.mulDiv(psQuote3, 50000000000, psBase3 + 50000000000);');
    expect(fragment).toContain('(psOut3 * 25 + 9999) / 10000');
    expect(fragment).toContain('(psOut3 * 5 + 9999) / 10000');
    expect(fragment).not.toContain('* 0 +'); // zero creator fee term omitted
    const accounts = pumpswapAdapter.quoteAccounts(sellCfg);
    const { bytecode } = compileSvm(wrapQuoteMain(accounts.length, fragment, 'q3'));
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it('rejects amounts that cannot be quoted', async () => {
    const cfg = await fetchConfig(POOL);
    expect(() => pumpswapAdapter.emitQuote(cfg, 0, 0n)).toThrow('pumpswap amountIn must be a positive u64, got 0');
    expect(() => pumpswapAdapter.emitQuote(cfg, 0, 1n)).toThrow(
      'pumpswap quote amountIn 1 is too small (effective quote input below 2)',
    );
  });
});

describe('buildSwap', () => {
  it('encodes buy_exact_quote_in: disc + spendable u64 LE + min_out 1 + track_volume false', async () => {
    const cfg = await fetchConfig(POOL);
    const swap = pumpswapAdapter.buildSwap(cfg, user, 1_000_000_000n);
    expect(swap.programId).toBe(AMM_PROGRAM);
    expect(swap.data).toEqual(
      new Uint8Array([
        198, 46, 21, 82, 180, 217, 232, 112, // docs/svm-venues.md discriminator
        ...u64LEBytes(1_000_000_000n),
        ...u64LEBytes(1n),
        0, // OptionBool track_volume = false
      ]),
    );
  });

  it('orders the buy accounts exactly as docs/svm-venues.md lists them', async () => {
    const cfg = await fetchConfig(POOL);
    const swap = pumpswapAdapter.buildSwap(cfg, user, 1_000_000_000n);
    const expected: VenueAccount[] = [
      { ref: POOL, address: POOL, writable: true },
      { ref: 'user', writable: true, signer: true },
      { ref: GLOBAL_CONFIG, address: GLOBAL_CONFIG },
      { ref: PUMP_MINT, address: PUMP_MINT },
      { ref: USDC_MINT, address: USDC_MINT },
      { ref: 'user-pump-ata', writable: true }, // user_base_token_account = outAta on buy
      { ref: 'user-usdc-ata', writable: true },
      { ref: BASE_VAULT, address: BASE_VAULT, writable: true },
      { ref: QUOTE_VAULT, address: QUOTE_VAULT, writable: true },
      { ref: PROTOCOL_FEE_RECIPIENT, address: PROTOCOL_FEE_RECIPIENT },
      { ref: PROTOCOL_FEE_RECIPIENT_USDC_ATA, address: PROTOCOL_FEE_RECIPIENT_USDC_ATA, writable: true },
      { ref: TOKEN_2022, address: TOKEN_2022 },
      { ref: TOKENKEG, address: TOKENKEG },
      { ref: SYSTEM_PROGRAM, address: SYSTEM_PROGRAM },
      { ref: ASSOCIATED_TOKEN_PROGRAM, address: ASSOCIATED_TOKEN_PROGRAM },
      { ref: EVENT_AUTHORITY, address: EVENT_AUTHORITY },
      { ref: AMM_PROGRAM, address: AMM_PROGRAM },
      { ref: CREATOR_VAULT_ATA_DEFAULT_USDC, address: CREATOR_VAULT_ATA_DEFAULT_USDC, writable: true },
      { ref: CREATOR_VAULT_AUTHORITY_DEFAULT, address: CREATOR_VAULT_AUTHORITY_DEFAULT },
      { ref: GLOBAL_VOLUME_ACCUMULATOR, address: GLOBAL_VOLUME_ACCUMULATOR },
      { ref: USER_VOLUME_ACCUMULATOR_REF, writable: true },
      { ref: FEE_CONFIG, address: FEE_CONFIG },
      { ref: FEE_PROGRAM, address: FEE_PROGRAM },
      // remaining accounts: no pool-v2 (coin_creator unset), buyback pair always
      { ref: BUYBACK_FEE_RECIPIENT, address: BUYBACK_FEE_RECIPIENT },
      { ref: BUYBACK_USDC_ATA, address: BUYBACK_USDC_ATA, writable: true },
    ];
    expect(swap.accounts).toEqual(expected);
  });

  it('encodes sell: disc + base_amount_in u64 LE + min_out 1, no volume accumulators', async () => {
    const cfg = await fetchConfig(POOL);
    const sellCfg: PumpswapPoolConfig = { ...cfg, direction: 'baseToQuote' };
    const swap = pumpswapAdapter.buildSwap(sellCfg, user, 50_000_000_000n);
    expect(swap.data).toEqual(
      new Uint8Array([
        51, 230, 133, 164, 1, 127, 131, 173, // docs/svm-venues.md discriminator
        ...u64LEBytes(50_000_000_000n),
        ...u64LEBytes(1n),
      ]),
    );
    expect(swap.accounts).toHaveLength(23); // 21 fixed + buyback pair
    // Base is the input token on a sell.
    expect(swap.accounts[5]).toEqual({ ref: 'user-usdc-ata', writable: true });
    expect(swap.accounts[6]).toEqual({ ref: 'user-pump-ata', writable: true });
    expect(swap.accounts[19]).toEqual({ ref: FEE_CONFIG, address: FEE_CONFIG });
    expect(swap.accounts[20]).toEqual({ ref: FEE_PROGRAM, address: FEE_PROGRAM });
    expect(swap.accounts[21]).toEqual({ ref: BUYBACK_FEE_RECIPIENT, address: BUYBACK_FEE_RECIPIENT });
    expect(swap.accounts[22]).toEqual({ ref: BUYBACK_USDC_ATA, address: BUYBACK_USDC_ATA, writable: true });
    expect(swap.accounts.map((account) => account.ref)).not.toContain(USER_VOLUME_ACCUMULATOR_REF);
  });

  it('inserts the pool-v2 remaining account when a coin creator is set', async () => {
    const cfg = await fetchConfig(CANONICAL_POOL);
    const swap = pumpswapAdapter.buildSwap(cfg, user, 1_000_000_000n);
    expect(swap.accounts).toHaveLength(26); // 23 fixed + pool-v2 + buyback pair
    expect(swap.accounts[23]).toEqual({ ref: CANONICAL_POOL_V2, address: CANONICAL_POOL_V2 });
  });

  it('rejects out-of-range amounts and disabled sells', async () => {
    const cfg = await fetchConfig(POOL);
    expect(() => pumpswapAdapter.buildSwap(cfg, user, 0n)).toThrow('pumpswap amountIn must be a positive u64, got 0');
    expect(() => pumpswapAdapter.buildSwap(cfg, user, 1n << 64n)).toThrow(
      `pumpswap amountIn must be a positive u64, got ${1n << 64n}`,
    );
    // disable_flags bit 4 blocks sells; buys still pass fetchPoolConfig.
    const doctored = withFixture(GLOBAL_CONFIG, (data) => {
      data[56] = 1 << 4;
      return data;
    });
    const sellCfg: PumpswapPoolConfig = { ...(await fetchConfig(POOL, doctored)), direction: 'baseToQuote' };
    expect(() => pumpswapAdapter.buildSwap(sellCfg, user, 1_000_000_000n)).toThrow(
      'pumpswap gate: sells are disabled (global config disable_flags 16)',
    );
  });

  it('rejects disabled buys once the direction is resolved', async () => {
    // disable_flags bit 3 blocks buys; the resolved-direction gate lives in buildSwap
    // (fetchPoolConfig's default direction is 'quoteToBase' = a buy, so no flip needed here).
    const doctored = withFixture(GLOBAL_CONFIG, (data) => {
      data[56] = 1 << 3;
      return data;
    });
    const cfg = await fetchConfig(POOL, doctored);
    expect(() => pumpswapAdapter.buildSwap(cfg, user, 1_000_000_000n)).toThrow(
      'pumpswap gate: buys are disabled (global config disable_flags 8)',
    );
  });
});
