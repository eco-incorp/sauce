/**
 * Perena Token-2022 handling. Perena records each pair's token program from the
 * pool's own `x_is_2022` byte and always attaches BOTH the legacy Tokenkeg and
 * the Token-2022 program accounts to the swap CPI (the numeraire IDL requires
 * both unconditionally), so a Token-2022-side pool ROUTES rather than being
 * dropped, and the quote math is token-program-agnostic — a Token-2022 pool and
 * an otherwise-identical legacy pool produce the EXACT same quote.
 *
 * No mainnet fixture is vendored here, so this builds a minimal synthetic
 * StablePool (curve params equal across pairs and a == b, as fetchPoolConfig
 * requires).
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { perena } from '../../../src/svm/venues/perena/index.js';
import type { PerenaPoolConfig } from '../../../src/svm/venues/perena/index.js';

const POOL = address('2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ');
const A_MINT = address('So11111111111111111111111111111111111111112');
const B_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const A_VAULT = address('GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL');
const B_VAULT = address('4MYrPgjgFceyhtwhG1ZX8UVb4wn1aQB5wzMimtFqg7U8');
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const STABLE_POOL_ACCOUNT_SIZE = 4024;
const STABLE_POOL_DISCRIMINATOR = [0xef, 0x5b, 0x5d, 0xa2, 0xab, 0x0e, 0x2a, 0x42];
const PAIRS_BASE = 152;
const PAIR_STRIDE = 368;
const P_X_RESERVE = 32;
const P_Y_RESERVE = 40;
const P_CURVE_AMP = 48;
const P_CURVE_A = 64;
const P_CURVE_B = 80;
const P_INV_L = 96;
const P_X_MINT = 144;
const P_X_VAULT = 176;
const P_RATE_NUM = 224;
const P_RATE_DENOM = 228;
const P_DECIMALS = 232;
const P_X_IS_2022 = 234;
const OFF_STATUS = 3880;
const OFF_FEE_NUM = 3884;
const OFF_FEE_DENOM = 3888;

const pairOff = (i: 0 | 1, field: number): number => PAIRS_BASE + i * PAIR_STRIDE + field;

function u64(buf: Uint8Array, off: number, v: bigint): void {
  for (let i = 0; i < 8; i++) buf[off + i] = Number((v >> BigInt(8 * i)) & 0xffn);
}
function u32(buf: Uint8Array, off: number, v: number): void {
  for (let i = 0; i < 4; i++) buf[off + i] = (v >> (8 * i)) & 0xff;
}
function pk(buf: Uint8Array, off: number, a: Address): void {
  buf.set(getAddressCodec().encode(a), off);
}

/** Build a synthetic StablePool whose pair 0/pair 1 x_is_2022 flags are as given. */
function makeStablePool(a2022: boolean, b2022: boolean): Uint8Array {
  const buf = new Uint8Array(STABLE_POOL_ACCOUNT_SIZE);
  buf.set(STABLE_POOL_DISCRIMINATOR, 0);
  u32(buf, OFF_STATUS, 16); // even -> not paused
  u32(buf, OFF_FEE_NUM, 0);
  u32(buf, OFF_FEE_DENOM, 1);

  const amp = 1000n;
  const a = 100n; // curve_a === curve_b required
  const pair = (i: 0 | 1, xMint: Address, xVault: Address, is2022: boolean, xRes: bigint, yRes: bigint, l: bigint) => {
    u64(buf, pairOff(i, P_X_RESERVE), xRes);
    u64(buf, pairOff(i, P_Y_RESERVE), yRes);
    u64(buf, pairOff(i, P_CURVE_AMP), amp); // u128 low; high 8 bytes stay 0
    u64(buf, pairOff(i, P_CURVE_A), a);
    u64(buf, pairOff(i, P_CURVE_B), a);
    u64(buf, pairOff(i, P_INV_L), l);
    pk(buf, pairOff(i, P_X_MINT), xMint);
    pk(buf, pairOff(i, P_X_VAULT), xVault);
    u32(buf, pairOff(i, P_RATE_NUM), 1);
    u32(buf, pairOff(i, P_RATE_DENOM), 1);
    buf[pairOff(i, P_DECIMALS)] = 6;
    buf[pairOff(i, P_X_IS_2022)] = is2022 ? 1 : 0;
  };
  pair(0, A_MINT, A_VAULT, a2022, 2_000_000_000n, 1_000_000_000n, 1_000_000_000n);
  pair(1, B_MINT, B_VAULT, b2022, 1_000_000_000n, 2_000_000_000n, 1_000_000_000n);
  return buf;
}

const loaderFor = (bytes: Uint8Array) => async (addr: Address) => (addr === POOL ? new Uint8Array(bytes) : null);

describe('perena Token-2022 handling', () => {
  it('routes a Token-2022-side pool (fetchPoolConfig resolves, is2022 flag recorded)', async () => {
    const cfg = (await perena.fetchPoolConfig(loaderFor(makeStablePool(true, false)), POOL)) as PerenaPoolConfig;
    expect(cfg.venue).toBe('perena');
    expect(cfg.aIs2022).toBe(true);
    expect(cfg.bIs2022).toBe(false);
  });

  it('buildSwap always attaches BOTH the legacy and Token-2022 program accounts', async () => {
    const cfg = await perena.fetchPoolConfig(loaderFor(makeStablePool(true, false)), POOL);
    const user = { inAta: 'user-in', outAta: 'user-out', owner: 'user-owner' } as never;
    const swap = perena.buildSwap!(cfg, user, 1_000_000n);
    const addrs = swap.accounts.map((acc) => acc.address);
    expect(addrs).toContain(TOKENKEG);
    expect(addrs).toContain(TOKEN_2022);
  });

  it('quote is token-program-agnostic: a Token-2022 pool and a legacy pool quote identically', async () => {
    const t22 = await perena.fetchPoolConfig(loaderFor(makeStablePool(true, true)), POOL);
    const legacy = await perena.fetchPoolConfig(loaderFor(makeStablePool(false, false)), POOL);
    const amountIn = 1_000_000n;
    const qT22 = perena.referenceQuote!(t22, { [POOL]: makeStablePool(true, true) }, amountIn, 0n);
    const qLegacy = perena.referenceQuote!(legacy, { [POOL]: makeStablePool(false, false) }, amountIn, 0n);
    expect(qLegacy).toBe(qT22);
    expect(qT22).toBeGreaterThan(0n);
  });
});
