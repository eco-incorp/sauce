/**
 * Perena Numeraire — a hub-and-spoke multi-stablecoin AMM on Solana. Program
 * NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P. No public source repo for the
 * swap instruction was found (the maintained `@perena/numeraire-sdk` npm
 * package builds instructions only — it has no local quote/simulate math of
 * its own either, and relies on the SAME on-chain `swap_exact_in_quote`
 * this module validates against). Every layout/math claim below is either
 * lifted verbatim from the program's own on-chain Anchor IDL (fetched from
 * the IDL PDA: `createAddressWithSeed(findProgramAddress([], programId),
 * "anchor:idl", programId)`, 6,594 decompressed bytes) or empirically
 * confirmed against REAL mainnet accounts.
 *
 * ACCOUNT LAYOUT (bytemuck `repr(C)`, Anchor 8-byte discriminator prefix
 * still applies — offsets below are ABSOLUTE from the account start):
 *
 * `StablePool` (4,024 bytes, disc ef5b5da2ab0e2a42): pool_seed@8, lp_mint@40,
 * whitelisted_adder@72, owner@104, inv_T@136 (u64), inv_T_max@144 (u64),
 * pairs: [VirtualStablePair; 10]@152 (368 bytes each, NO own discriminator —
 * embedded, not a standalone account), weights: [u32; 10]@3832,
 * total_weight@3872 (u64), status@3880 (u32), fee_num@3884 (u32),
 * fee_denom@3888 (u32), decimals@3892 (u8), num_stables@3893 (u8).
 *
 * `VirtualStablePair` (376 bytes as its OWN standalone account, disc
 * 709987df35f78165 — 368 + the 8-byte disc; embedded within StablePool.pairs
 * the same 368-byte struct carries no leading disc): pair_authority@0 (32),
 * x_reserve_amount@32 (u64, "cash" — the REAL token balance in x_vault),
 * y_reserve@40 (u64, "liability" — a virtual, same-decimals accounting
 * number with NO backing token), curve_Amp@48 (u128, low 64 used — see
 * SCOPE below), curve_a@64 (u128), curve_b@80 (u128), inv_L@96 (u128, a
 * per-pair normalization scale — see MATH), owner@112 (32), x_mint@144 (32),
 * x_vault@176 (32), curve_alpha@208 (u64, an f64 bit pattern — a Newton-seed
 * cache for the on-chain program's OWN iterative solve, unused by this
 * closed-form ladder), curve_beta@216 (u64, ditto, = 1/curve_alpha),
 * newest_rate_num@224 (u32), newest_rate_denom@228 (u32), decimals@232 (u8),
 * pair_index@233 (u8), x_is_2022@234 (u8).
 *
 * MATH — the invariant (from the IDL's own doc comments on curve_Amp/inv_L):
 * `x/L + y/L + a + b - A/(x/L+a) - A/(y/L+b) = D`, all of A/a/b implicitly
 * scaled by 1e6 (confirmed against the maintained `@perena/numeraire-sdk`'s
 * `createPair` — `curveAmp: new BN(A * 1e6)` with `NORMALIZED_VALUE_DECIMALS
 * = 6`). Empirically, for EVERY real pair sampled, evaluating this equation
 * at the pair's OWN CURRENT (x, y, L) reproduces the SAME constant D across
 * every pair/pool sharing the same (A, a) tier, and that D equals the
 * equilibrium value of the LHS at x/L = y/L = 1 — i.e. D is a PURE FUNCTION
 * of (A, a, b), not a stored per-pool/per-pair value (confirmed to ~5 sig
 * figs across 3 real pairs spanning two (A, a) tiers). Solving this equation
 * for one side given the other is a QUADRATIC in `(side/L + a)`:
 * `v^2 - K*v - A = 0` (K folds the fixed side + D), so `v = (K + sqrt(K^2 +
 * 4A)) / 2` (positive root — sqrt is always >= |K|, so v is always >= 0).
 *
 * A swap moves through TWO such per-pair curves via the shared "y" side
 * (the virtual liability, acting as an internal numeraire): hop 1 deposits
 * into the IN pair's cash (x), holding its liability's SCALE (L) fixed, and
 * SOLVES for the new liability (y) that keeps that pair's own D — the
 * liability DECREASE is the numeraire released. Hop 2 feeds that numeraire
 * INTO the OUT pair's liability (y increases, L fixed), and solves for its
 * new cash (x) — the cash DECREASE is the delivered output. This 2-hop
 * closed form was reverse-engineered (no source was available — see above)
 * and VALIDATED against the program's own read-only `swap_exact_in_quote`
 * instruction via `simulateTransaction`, AND against a real `swap_exact_in`
 * (hintless) instruction actually landed through LiteSVM against the REAL
 * perena.so binary (dumped from mainnet-beta) — both on REAL mainnet-beta
 * state, pool 2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ (the flagship
 * USDC/USDT/PYUSD "USD*" pool, the SAME account frozen as
 * test/svm/fixtures/perena/pool.json), pair 0 (USDC) -> pair 1 (USDT), at
 * THREE sizes:
 *
 *   1_000_000    (1 USDC)   -> quote 1_000_742  | real swap 1_000_742  | this model (shipped, post-margin) 1_000_243
 *   10_000_000   (10 USDC)  -> quote 10_007_419 | real swap 10_007_419 | this model (shipped, post-margin) 10_002_417
 *   100_000_000  (100 USDC) -> quote 100_073_846| real swap 100_073_760| this model (shipped, post-margin) 100_023_811
 *
 * (quote and real-swap agree to within 86 raw units of each other at every
 * size — this pool's `swap_exact_in_quote` and `swap_exact_in` clearly share
 * the same underlying compute path.) See budget.ts's CU_FAMILIES entry for
 * this same real-CPI run's measured compute cost.
 *
 * RESIDUAL: pre-margin (i.e. dividing the shipped numbers above back out by
 * (1 - MARGIN_BPS/10000)), this closed form lands within ~0.02 bps of BOTH
 * the real quote and the real executed swap at every size tested — an
 * EARLIER validation pass against a since-drifted pool snapshot (ordinary
 * mainnet trading between checks, not a code change) measured a larger
 * ~0.3-0.44 bps gap, all in the same direction; take "~0.02-0.44 bps,
 * always non-favourable" as the honest measured range rather than a single
 * constant. This is the same "disclosed, measured, one-sided residual"
 * class every venue's off-chain quote-vs-real-execution drift in this repo
 * already carries, backstopped by `minOut` regardless, not a fund-safety
 * gap — plausibly because the real on-chain `swap_exact_in`/
 * `swap_exact_in_hinted` genuinely iterates via Newton's method seeded by
 * the cached curve_alpha/curve_beta (see `@perena/numeraire-sdk`'s
 * `createPair`, which computes `trueAlpha` via an external symbolic solver)
 * rather than solving this closed form exactly. MARGIN_BPS (5, i.e. 0.05%)
 * is a deliberate, disclosed downward haircut on the raw closed-form output
 * — comfortably above the measured overshoot at either end of that range —
 * so this ladder's OFF-CHAIN election quote never favourably exceeds the
 * real venue's own arithmetic (a model MORE favourable than the venue's own
 * math is worse than a crude one, because a favourable error wins elections
 * it cannot deliver).
 *
 * SCOPE (disclosed, not a correctness gap): this ladder only quotes pair
 * INDEX 0 <-> pair INDEX 1 of a StablePool (covering every 2-asset pool
 * outright, plus pair-(0,1) of any >2-asset hub pool — 9 of 10 real
 * mainnet StablePool accounts sampled at integration time are exactly
 * 2-asset; the 10th is the 3-asset flagship above, whose pair-(0,1)
 * combination this ladder DOES serve). Every OTHER pairwise combination of
 * a >2-asset pool (e.g. asset0<->asset2) is not discovered by the
 * single-memcmp SVM_FAMILY_FILTERS entry this venue wires — a disclosed
 * follow-up, not attempted here. Additionally, `fetchPoolConfig` requires
 * curve_a === curve_b (asserted required by the maintained SDK's own
 * `createPair`: "need a=b") and BOTH pairs' `newest_rate_num/denom` == 1:1
 * and identical `decimals` — the cross-rate/cross-decimals numeraire
 * conversion this would otherwise need is UNVALIDATED (every currently
 * PAUSED — see below — real pool sampled carries a non-1:1 rate; every
 * currently ACTIVE 2-asset pool sampled is 1:1, same-decimals), so a pool
 * outside this validated topology self-drops via `gate` rather than risk an
 * unvalidated, possibly-favourable formula. `high64` of the u128
 * curve_Amp/curve_a/curve_b fields is asserted zero (true of every real
 * value sampled) for the same reason.
 *
 * STATUS/PAUSE: `status` is a u32 with unknown bit semantics (no source, no
 * IDL enum) — inferred PURELY from observation (status 16/0 quote
 * successfully; status 119 fails `swap_exact_in_quote` with the program's
 * own `FunctionPaused` error). This ladder treats `status` ODD as paused
 * (self-drop) — a snapshot check at `fetchPoolConfig`/`gate` time only (SVM
 * execution-time CPI catch/re-route is a platform impossibility — see
 * CLAUDE.md); a real swap CPI would fail loudly regardless if this
 * inference is ever wrong for some untested status value.
 *
 * CPI: `swap_exact_in` (the hintless variant — disc 68 68 83 56 a1 bd b4 d8;
 * `SwapExactInHintlessData { in_index: u8, out_index: u8, exact_amount_in:
 * u64, min_amount_out: u64 }`). Accounts (order fixed by the IDL): pool[w],
 * in_mint[w], out_mint[w], in_trader[w], out_trader[w], in_vault[w],
 * out_vault[w] (REAL vault addresses — a real swap needs the real token
 * movement; the optional-account None-sentinel this repo's other venues use
 * is for `swap_exact_in_quote`'s own no-transfer path, not the real swap),
 * numeraire_config (a program-wide PDA, seeds `["config"]` — hardcoded
 * below, deterministic), payer[signer], token_program (Tokenkeg...),
 * token_2022_program (TokenzQdB... — a fixed IDL `address` constraint, not
 * caller-resolved, attached unconditionally).
 */
import { address, getAddressDecoder } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountBytesMap, AccountLoader, PoolConfig, SvmVenueAdapter, SwapUser, VenueAccount, VenueSwap } from '../types.js';

const SLUG = 'perena';
export const PERENA_PROGRAM_ID = address('NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
/** PDA: findProgramAddress([utf8("config")], PERENA_PROGRAM_ID) — a single program-wide singleton. */
const NUMERAIRE_CONFIG = address('FS159v4b2jo3fjGBaUFmDzgx7k616XhpKhMwX2Q3HeeD');

export const STABLE_POOL_ACCOUNT_SIZE = 4024;
/** sha256('account:StablePool')[0..8]. */
export const STABLE_POOL_DISCRIMINATOR = [0xef, 0x5b, 0x5d, 0xa2, 0xab, 0x0e, 0x2a, 0x42];
/** sha256('global:swap_exact_in')[0..8] — the hintless variant. */
const SWAP_EXACT_IN_DISCRIMINATOR = Uint8Array.from([104, 104, 131, 86, 161, 189, 180, 216]);

// StablePool absolute offsets.
const OFF_STATUS = 3880;
const OFF_FEE_NUM = 3884;
const OFF_FEE_DENOM = 3888;
const PAIRS_BASE = 152;
const PAIR_STRIDE = 368;
// VirtualStablePair (embedded, no own disc) field offsets relative to a pair's base.
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

const pairOff = (i: 0 | 1, field: number): number => PAIRS_BASE + i * PAIR_STRIDE + field;

/**
 * Native on-chain scale of curve_a/curve_b/curve_Amp (confirmed via
 * @perena/numeraire-sdk's NORMALIZED_VALUE_DECIMALS = 6) — the STORAGE
 * scale only, NOT the precision this ladder computes the x/L, y/L ratios
 * at (see WAD below).
 */
const PARAM_SCALE = 1_000_000n;
/**
 * The fixed-point scale the x/L, y/L RATIO computation runs at internally —
 * 1e18, NOT PARAM_SCALE (1e6). This matters: invL is ~1.5e11 on the
 * validated flagship pool, so a ratio computed to only 1e6 precision loses
 * up to 1 "ratio unit", which — when multiplied back by invL to recover a
 * raw token amount — reappears as an error of up to invL/PARAM_SCALE
 * (~150,000 raw units on that pool, i.e. ~15 CENTS out of a $1 trade,
 * roughly the same order of magnitude as the entire expected output). This
 * was caught empirically: computing at PARAM_SCALE precision (matching the
 * STORED params' own scale) gave 792,982 for a 1 USDC input against the
 * real flagship-pool state — 20.7% off the real swap's 1,000,750 — while
 * this file's continuous-float validation (double precision, effectively
 * ~1e15 significant digits) never exhibited the bug. WAD=1e18 makes the
 * SAME error term negligible (invL/WAD ~1.5e-7 raw units). curve_a/curve_Amp
 * are rescaled from PARAM_SCALE to WAD once (RESCALE, a compile-time
 * constant) before use.
 */
const WAD = 1_000_000_000_000_000_000n;
const RESCALE = WAD / PARAM_SCALE;
/** Disclosed conservative haircut on the raw closed-form output — see module header RESIDUAL. */
const MARGIN_BPS = 5n;

function readAddr(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}

export interface PerenaPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'aToB': pair 0 (A) in -> pair 1 (B) out. 'bToA' is the reverse. */
  direction: 'aToB' | 'bToA';
  aMint: Address;
  aVault: Address;
  aIs2022: boolean;
  bMint: Address;
  bVault: Address;
  bIs2022: boolean;
  /** Curve params (immutable post-creation — no admin instruction changes them), low 64 of the u128 fields. */
  ampRaw: bigint;
  /** curve_a == curve_b is REQUIRED (asserted at fetch time) — this is that shared value. */
  aRaw: bigint;
  /** Snapshot at fetch time — see module header STATUS/PAUSE. */
  pausedAtFetch: boolean;
  /** Snapshot at fetch time — see module header SCOPE (both pairs' rate must be 1:1). */
  rateOkAtFetch: boolean;
  /** Snapshot at fetch time — see module header SCOPE (both pairs must share decimals). */
  decimalsOkAtFetch: boolean;
}

function asPerenaConfig(cfg: PoolConfig): PerenaPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder/adapter got a '${cfg.venue}' pool config`);
  return cfg as PerenaPoolConfig;
}

/** floor(a*b/c), 0 on a zero denominator (mirrors the engine's Math.mulDiv/DIV rule). */
function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  return c === 0n ? 0n : (a * b) / c;
}

/** Floor integer square root (mirrors the engine's Math.sqrt op). */
function isqrt(value: bigint): bigint {
  if (value < 0n) throw new Error(`${SLUG} isqrt needs a non-negative value, got ${value}`);
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** D (WAD-units), a pure function of the pool's immutable curve params (a === b required, both already rescaled to WAD) — see module header MATH. */
function dScaled(ampWad: bigint, aWad: bigint): bigint {
  const p = WAD + aWad;
  return 2n * p - 2n * mulDivFloor(ampWad, WAD, p);
}

/** The positive root of v^2 - K*v - Amp*WAD = 0 (v = the OTHER side's (ratio + a), WAD-units; ampWad already rescaled to WAD). */
function solveV(k: bigint, ampWad: bigint): bigint {
  const disc = k * k + 4n * ampWad * WAD;
  const sq = isqrt(disc);
  return (k + sq) / 2n; // always >= 0: sq >= |k|.
}

export interface PerenaLiveState {
  ampRaw: bigint;
  aRaw: bigint;
  feeNum: bigint;
  feeDenom: bigint;
  xIn: bigint;
  yIn: bigint;
  lIn: bigint;
  xOut: bigint;
  yOut: bigint;
  lOut: bigint;
}

/**
 * TS mirror of the emitted fragment's per-rung quote — see module header
 * MATH for the 2-hop derivation and RESIDUAL for the measured, disclosed gap
 * to the real venue, and MARGIN_BPS for the conservative haircut applied
 * here.
 */
export function perenaSwapOut(live: PerenaLiveState, x: bigint): bigint {
  const { ampRaw, aRaw, feeNum, feeDenom, xIn, yIn, lIn, xOut, yOut, lOut } = live;
  if (x <= 0n || lIn <= 0n || lOut <= 0n) return 0n;
  const ampWad = ampRaw * RESCALE;
  const aWad = aRaw * RESCALE;
  const d = dScaled(ampWad, aWad);

  const net = mulDivFloor(x, feeNum, feeDenom);
  const xIn2 = xIn + net;
  const uIn = mulDivFloor(xIn2, WAD, lIn);
  const pIn = uIn + aWad;
  if (pIn <= 0n) return 0n;
  const kIn = d - pIn + mulDivFloor(ampWad, WAD, pIn);
  const vIn = solveV(kIn, ampWad);
  const wIn = vIn - aWad;
  if (wIn < 0n) return 0n;
  const yIn2 = mulDivFloor(wIn, lIn, WAD);
  if (yIn2 >= yIn) return 0n;
  const deltaNumeraire = yIn - yIn2;

  const wOut = mulDivFloor(yOut + deltaNumeraire, WAD, lOut);
  const pOut = wOut + aWad;
  if (pOut <= 0n) return 0n;
  const kOut = d - pOut + mulDivFloor(ampWad, WAD, pOut);
  const vOut = solveV(kOut, ampWad);
  const uOut = vOut - aWad;
  if (uOut < 0n) return 0n;
  const xOut2 = mulDivFloor(uOut, lOut, WAD);
  if (xOut2 >= xOut) return 0n;
  const raw = xOut - xOut2;
  return mulDivFloor(raw, 10_000n - MARGIN_BPS, 10_000n);
}

async function fetchPoolConfig(load: AccountLoader, pool: Address): Promise<PerenaPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== STABLE_POOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} pool ${pool} has unexpected size ${data.length} (want ${STABLE_POOL_ACCOUNT_SIZE})`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== STABLE_POOL_DISCRIMINATOR[i]) {
      throw new Error(`${SLUG} pool ${pool} has a non-StablePool discriminator`);
    }
  }

  const pair = (i: 0 | 1) => ({
    xMint: readAddr(data, pairOff(i, P_X_MINT)),
    xVault: readAddr(data, pairOff(i, P_X_VAULT)),
    xIs2022: readUintLE(data, pairOff(i, P_X_IS_2022), 1) !== 0n,
    decimals: readUintLE(data, pairOff(i, P_DECIMALS), 1),
    rateNum: readUintLE(data, pairOff(i, P_RATE_NUM), 4),
    rateDenom: readUintLE(data, pairOff(i, P_RATE_DENOM), 4),
    ampLow: readUintLE(data, pairOff(i, P_CURVE_AMP), 8),
    ampHigh: readUintLE(data, pairOff(i, P_CURVE_AMP) + 8, 8),
    aLow: readUintLE(data, pairOff(i, P_CURVE_A), 8),
    aHigh: readUintLE(data, pairOff(i, P_CURVE_A) + 8, 8),
    bLow: readUintLE(data, pairOff(i, P_CURVE_B), 8),
    bHigh: readUintLE(data, pairOff(i, P_CURVE_B) + 8, 8),
  });
  const p0 = pair(0);
  const p1 = pair(1);

  if (p0.ampHigh !== 0n || p1.ampHigh !== 0n || p0.aHigh !== 0n || p1.aHigh !== 0n || p0.bHigh !== 0n || p1.bHigh !== 0n) {
    throw new Error(`${SLUG} pool ${pool} carries a curve param above u64 — outside this ladder's validated range`);
  }
  if (p0.ampLow !== p1.ampLow || p0.aLow !== p1.aLow || p0.bLow !== p1.bLow) {
    throw new Error(`${SLUG} pool ${pool} has mismatched curve params between its pairs (expected pool-wide constants)`);
  }
  if (p0.aLow !== p0.bLow) {
    throw new Error(`${SLUG} pool ${pool} has curve_a !== curve_b — outside this ladder's validated range (see module header SCOPE)`);
  }

  const status = readUintLE(data, OFF_STATUS, 4);
  const rateOkAtFetch =
    p0.rateNum === p0.rateDenom && p0.rateNum > 0n && p1.rateNum === p1.rateDenom && p1.rateNum > 0n;
  const decimalsOkAtFetch = p0.decimals === p1.decimals;

  return {
    venue: SLUG,
    pool,
    direction: 'aToB',
    aMint: p0.xMint,
    aVault: p0.xVault,
    aIs2022: p0.xIs2022,
    bMint: p1.xMint,
    bVault: p1.xVault,
    bIs2022: p1.xIs2022,
    ampRaw: p0.ampLow,
    aRaw: p0.aLow,
    pausedAtFetch: status % 2n !== 0n,
    rateOkAtFetch,
    decimalsOkAtFetch,
  };
}

function quoteAccounts(cfg: PoolConfig): VenueAccount[] {
  const c = asPerenaConfig(cfg);
  return [{ ref: poolRef(c, 'pool'), address: c.pool }];
}

function liveStateFrom(c: PerenaPoolConfig, pool: Uint8Array): PerenaLiveState {
  const inIdx: 0 | 1 = c.direction === 'aToB' ? 0 : 1;
  const outIdx: 0 | 1 = c.direction === 'aToB' ? 1 : 0;
  return {
    ampRaw: c.ampRaw,
    aRaw: c.aRaw,
    feeNum: readUintLE(pool, OFF_FEE_NUM, 4),
    feeDenom: readUintLE(pool, OFF_FEE_DENOM, 4),
    xIn: readUintLE(pool, pairOff(inIdx, P_X_RESERVE), 8),
    yIn: readUintLE(pool, pairOff(inIdx, P_Y_RESERVE), 8),
    lIn: readUintLE(pool, pairOff(inIdx, P_INV_L), 8),
    xOut: readUintLE(pool, pairOff(outIdx, P_X_RESERVE), 8),
    yOut: readUintLE(pool, pairOff(outIdx, P_Y_RESERVE), 8),
    lOut: readUintLE(pool, pairOff(outIdx, P_INV_L), 8),
  };
}

function emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
  const c = asPerenaConfig(cfg);
  const readPrefix = `s${i}`;
  // Account model (RS/svm target): the fragment reads through main()'s ordered
  // `Account` params, not `accountUint("<ref>", …)` string refs. `quoteAccounts()`
  // attaches only the pool, so every read is `svm.sload(acc0, …).toLe()` and the
  // manifest comes back with the single slot 0 == quoteAccounts()[0] (the pool).
  return [...readLines(c, 'acc0', readPrefix), ...arithmeticLines(c, readPrefix, readPrefix, String(amountIn), `q${i}`)].join('\n');
}

/**
 * The 6 reserve/scale reads + 2 fee reads, ONCE per trade (`readPrefix`-named
 * locals) — read ONCE and reused by every rung's arithmetic (see
 * `arithmeticLines`), matching every other family's emitSetup/
 * emitLadderQuote split (re-reading the SAME 8 fields on every rung would
 * multiply this venue's dominant CU cost for no reason — `svm.sload` reads
 * are not free, see budget.ts's per-family CU pins). `acc` is the `main(...)`
 * Account param the pool binds to — `acc0` here, since `quoteAccounts()`
 * attaches the pool at index 0 (`accountUint` lowered to CAST_LE, so `.toLe()`
 * is the exact endianness match for these u64/u32 LE fields).
 */
function readLines(c: PerenaPoolConfig, acc: string, readPrefix: string): string[] {
  const inIdx: 0 | 1 = c.direction === 'aToB' ? 0 : 1;
  const outIdx: 0 | 1 = c.direction === 'aToB' ? 1 : 0;
  const p = readPrefix;
  return [
    `  const ${p}xin = svm.sload(${acc}, ${pairOff(inIdx, P_X_RESERVE)}, 8).toLe();`,
    `  const ${p}yin = svm.sload(${acc}, ${pairOff(inIdx, P_Y_RESERVE)}, 8).toLe();`,
    `  const ${p}lin = svm.sload(${acc}, ${pairOff(inIdx, P_INV_L)}, 8).toLe();`,
    `  const ${p}xout = svm.sload(${acc}, ${pairOff(outIdx, P_X_RESERVE)}, 8).toLe();`,
    `  const ${p}yout = svm.sload(${acc}, ${pairOff(outIdx, P_Y_RESERVE)}, 8).toLe();`,
    `  const ${p}lout = svm.sload(${acc}, ${pairOff(outIdx, P_INV_L)}, 8).toLe();`,
    `  const ${p}fn = svm.sload(${acc}, ${OFF_FEE_NUM}, 4).toLe();`,
    `  const ${p}fd = svm.sload(${acc}, ${OFF_FEE_DENOM}, 4).toLe();`,
  ];
}

/**
 * Statement lines computing `outVar` (declared via `let`) from expression
 * `x`, referencing the ALREADY-READ `readPrefix`-named locals from
 * `readLines` (not re-reading them) — shared by the plain adapter's
 * emitQuote (x a baked literal, readPrefix === tmpPrefix, one-shot) and the
 * ladder's emitLadderQuote/emitFinalQuote (x a runtime expression,
 * readPrefix is the persistent per-slot setup, tmpPrefix is rung- or
 * "f"-suffixed since every intermediate here is a fresh `const` per
 * emission site sharing one function scope).
 */
function arithmeticLines(c: PerenaPoolConfig, readPrefix: string, tmpPrefix: string, x: string, outVar: string): string[] {
  const r = readPrefix;
  const p = tmpPrefix;
  // Rescaled from PARAM_SCALE (1e6, the on-chain storage scale) to WAD
  // (1e18) — see the WAD constant's doc comment for why PARAM_SCALE itself
  // is FAR too coarse for the x/L, y/L ratio computation below.
  const amp = c.ampRaw * RESCALE;
  const a = c.aRaw * RESCALE;
  const d = dScaled(amp, a);
  const fourAmpWad = 4n * amp * WAD;
  return [
    `  let ${outVar} = 0;`,
    `  if (${x} > 0 && ${r}lin > 0 && ${r}lout > 0) {`,
    `    const ${p}net = Math.mulDiv(${x}, ${r}fn, ${r}fd);`,
    `    const ${p}xin2 = ${r}xin + ${p}net;`,
    `    const ${p}uin = Math.mulDiv(${p}xin2, ${WAD}, ${r}lin);`,
    `    const ${p}pin = ${p}uin + ${a};`,
    `    if (${p}pin > 0) {`,
    `      const ${p}kin = ${d} - ${p}pin + Math.mulDiv(${amp}, ${WAD}, ${p}pin);`,
    `      const ${p}discin = ${p}kin * ${p}kin + ${fourAmpWad};`,
    `      const ${p}vin = (${p}kin + Math.sqrt(${p}discin)) / 2;`,
    `      const ${p}win = ${p}vin - ${a};`,
    `      if (${p}win >= 0) {`,
    `        const ${p}yin2 = Math.mulDiv(${p}win, ${r}lin, ${WAD});`,
    `        if (${p}yin2 < ${r}yin) {`,
    `          const ${p}dnum = ${r}yin - ${p}yin2;`,
    `          const ${p}wout = Math.mulDiv(${r}yout + ${p}dnum, ${WAD}, ${r}lout);`,
    `          const ${p}pout = ${p}wout + ${a};`,
    `          if (${p}pout > 0) {`,
    `            const ${p}kout = ${d} - ${p}pout + Math.mulDiv(${amp}, ${WAD}, ${p}pout);`,
    `            const ${p}discout = ${p}kout * ${p}kout + ${fourAmpWad};`,
    `            const ${p}vout = (${p}kout + Math.sqrt(${p}discout)) / 2;`,
    `            const ${p}uout = ${p}vout - ${a};`,
    `            if (${p}uout >= 0) {`,
    `              const ${p}xout2 = Math.mulDiv(${p}uout, ${r}lout, ${WAD});`,
    `              if (${p}xout2 < ${r}xout) {`,
    `                const ${p}raw = ${r}xout - ${p}xout2;`,
    `                ${outVar} = Math.mulDiv(${p}raw, ${10_000n - MARGIN_BPS}, 10000);`,
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
  ];
}

/**
 * Ordered account list the swap_exact_in (hintless) instruction expects.
 * `refFn(role)` supplies the ref for every POOL-DERIVED account — the plain
 * adapter keys it by pool address (`poolRef`, multiple distinct pools of
 * this family can appear in one program), the ladder keys it by slot
 * (`ref(slot, role)`, matching every other family's buildSwapV2 — see
 * saber-stableswap/ladder.js's `roled` for the same convention, including
 * slot-scoping the token-program refs).
 */
function perenaAccounts(c: PerenaPoolConfig, user: SwapUser, refFn: (role: string) => string): VenueAccount[] {
  const inMint = c.direction === 'aToB' ? c.aMint : c.bMint;
  const outMint = c.direction === 'aToB' ? c.bMint : c.aMint;
  const inVault = c.direction === 'aToB' ? c.aVault : c.bVault;
  const outVault = c.direction === 'aToB' ? c.bVault : c.aVault;
  return [
    { ref: refFn('pool'), address: c.pool, writable: true },
    { ref: refFn('inMint'), address: inMint, writable: true },
    { ref: refFn('outMint'), address: outMint, writable: true },
    { ref: user.inAta, writable: true },
    { ref: user.outAta, writable: true },
    { ref: refFn('inVault'), address: inVault, writable: true },
    { ref: refFn('outVault'), address: outVault, writable: true },
    { ref: refFn('numeraireConfig'), address: NUMERAIRE_CONFIG },
    { ref: user.owner, signer: true },
    { ref: refFn('tokenProgram'), address: TOKEN_PROGRAM },
    { ref: refFn('token2022Program'), address: TOKEN_2022_PROGRAM },
  ];
}

const poolRef = (c: PerenaPoolConfig, role: string): string => `${SLUG}:${c.pool}:${role}`;

function buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
  const c = asPerenaConfig(cfg);
  const inIndex = c.direction === 'aToB' ? 0 : 1;
  const outIndex = c.direction === 'aToB' ? 1 : 0;
  const data = new Uint8Array(8 + 1 + 1 + 8 + 8);
  data.set(SWAP_EXACT_IN_DISCRIMINATOR, 0);
  data[8] = inIndex;
  data[9] = outIndex;
  new DataView(data.buffer).setBigUint64(10, amountIn, true);
  new DataView(data.buffer).setBigUint64(18, 1n, true); // min_amount_out — the recipe's own delta check is the real bound
  return { programId: PERENA_PROGRAM_ID, data, accounts: perenaAccounts(c, user, (role) => poolRef(c, role)) };
}

function referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, _now: bigint): bigint {
  const c = asPerenaConfig(cfg);
  const pool = state[c.pool];
  if (pool === undefined) throw new Error(`${SLUG} referenceQuote is missing account ${c.pool}`);
  return perenaSwapOut(liveStateFrom(c, pool), amountIn);
}

export const perena: SvmVenueAdapter = {
  slug: SLUG,
  kind: 'stable',
  programId: PERENA_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
  emitQuote,
  buildSwap,
  referenceQuote,
};

// ---- SvmVenueLadder (the SvmRoute production ladder) ----

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

