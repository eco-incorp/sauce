/**
 * Meteora DAMM v2 (cp-amm) venue adapter — sqrt-price quoting from the Pool
 * account ONLY. Vault balances must never enter the quote: they overstate
 * reserves by unclaimed LP/protocol fees, and for concentrated pools the
 * virtual reserves differ from real reserves. All byte offsets, formulas and
 * rounding rules follow docs/svm-venues.md, source-verified against the
 * cp-amm program (github.com/MeteoraAg/damm-v2, Pool = 8-byte discriminator +
 * 1104-byte zero-copy struct).
 *
 * Accepted pools (everything else is gated with a named error):
 * - pool_status == 0 (enabled), collect_fee_mode in {0, 1} — compounding
 *   pools (mode 2) use x*y=k on token_a_amount/token_b_amount instead;
 * - base_fee_mode in {0, 1} with period_frequency == 0 (static base fee,
 *   the common case) — rate-limiter/market-cap fees are amount-dependent,
 *   and time-scheduled fees need a clock the in-VM quote does not have;
 * - classic SPL or token-2022 mints WITHOUT a transfer-fee extension;
 * - activation_point == 0 when activation_type == 0 (slot) — a slot-typed
 *   point cannot be evaluated against the unix clock off-chain nor in the
 *   fragment; timestamp-typed (activation_type == 1) points gate in-fragment
 *   on block.timestamp instead (quote 0 before activation).
 *
 * Overflow bound for the in-VM fragment (engine arithmetic wraps at 2^256):
 * liquidity is u128 and every sqrt price is validated into
 * [MIN_SQRT_PRICE, MAX_SQRT_PRICE] with MAX_SQRT_PRICE < 2^97, so the largest
 * products are liquidity * sqrt_price < 2^225, amount_in << 128 < 2^192 and,
 * within the band, sqrt_price * next_sqrt_price < 2^194 — all comfortably
 * below 2^256, so plain ops are exact and Math.mulDiv is unnecessary. A
 * band-violating bToA next_sqrt_price can push sqrt_price * next_sqrt_price
 * past the wrap, but every such quote is clamped to 0 before it is used.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { ceilDiv, readUintLE } from '../math.js';
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from '../types.js';

const SLUG = 'meteora-damm-v2';

const PROGRAM_ID = address('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
/** Constant PDA ['pool_authority'] of the program — owner of both vaults. */
const POOL_AUTHORITY = address('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC');
/** Constant PDA ['__event_authority'] (Anchor event_cpi). */
const EVENT_AUTHORITY = address('3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const POOL_ACCOUNT_SIZE = 1112;
/** sha256('account:Pool')[0..8]. */
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
/** sha256('global:swap')[0..8]. */
const SWAP_DISCRIMINATOR = [248, 198, 158, 145, 225, 117, 135, 200];

const FEE_DENOMINATOR = 1_000_000_000n;
const MAX_FEE_NUMERATOR_V0 = 500_000_000n;
const MAX_FEE_NUMERATOR_V1 = 990_000_000n;
const MIN_SQRT_PRICE = 4295048016n;
const MAX_SQRT_PRICE = 79226673521066979257578248091n;
const Q128 = 1n << 128n;
const U64_MAX = (1n << 64n) - 1n;

export interface MeteoraDammV2PoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /**
   * Trade direction: 'aToB' when the input mint is tokenAMint (the default —
   * fetchPoolConfig cannot see the trade). Callers flip this to 'bToA' when
   * the input mint is tokenBMint; the mints are exposed for that decision.
   */
  direction: 'aToB' | 'bToA';
  tokenAMint: Address;
  tokenBMint: Address;
  tokenAVault: Address;
  tokenBVault: Address;
  tokenAProgram: Address;
  tokenBProgram: Address;
  /** 0 = BothToken (fee on output), 1 = OnlyB (fee on input for bToA). */
  collectFeeMode: number;
  /** Static base trade-fee numerator over 1e9. */
  cliffFeeNumerator: bigint;
  /** Fee cap by fee_version: 5e8 (v0) or 9.9e8 (v1). */
  maxFeeNumerator: bigint;
  /**
   * Non-null when dynamic_fee.initialized == 1: the quote adds
   * ceil((volatility_accumulator * binStep)^2 * variableFeeControl / 1e11)
   * to the base fee (exact only within filter_period — the program refreshes
   * volatility references from elapsed time pre-swap).
   */
  dynamicFee: { binStep: bigint; variableFeeControl: bigint } | null;
  activationPoint: bigint;
  /** 0 = slot, 1 = unix timestamp — the unit of activationPoint. */
  activationType: number;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  /** Snapshot at fetch time (the quote re-reads it live). */
  liquidity: bigint;
  /** Snapshot at fetch time (the quote re-reads it live). */
  sqrtPrice: bigint;
}

interface DecodedPool {
  cliffFeeNumerator: bigint;
  collectFeeMode: number;
  maxFeeNumerator: bigint;
  dynamicFee: { binStep: bigint; variableFeeControl: bigint } | null;
  volatilityAccumulator: bigint;
  tokenAMint: Address;
  tokenBMint: Address;
  tokenAVault: Address;
  tokenBVault: Address;
  tokenAFlag: number;
  tokenBFlag: number;
  activationPoint: bigint;
  activationType: number;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/** Decodes the Pool account and applies every state gate (named errors). */
function decodePool(pool: string, data: Uint8Array): DecodedPool {
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(`meteora-damm-v2 pool ${pool} account data is ${data.length} bytes, expected 1112`);
  }
  if (!POOL_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
    throw new Error(`meteora-damm-v2 pool ${pool} is not a cp-amm Pool account (discriminator mismatch)`);
  }
  const poolStatus = data[481];
  if (poolStatus !== 0) {
    throw new Error(`meteora-damm-v2 pool ${pool} is disabled (pool_status=${poolStatus})`);
  }
  const collectFeeMode = data[484];
  if (collectFeeMode > 1) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} is a compounding pool (collect_fee_mode=${collectFeeMode}); sqrt-price quoting does not apply`,
    );
  }
  const baseFeeMode = data[16];
  if (baseFeeMode >= 2) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} base_fee_mode=${baseFeeMode} (rate-limiter/market-cap scheduler) is amount-dependent and not supported`,
    );
  }
  const periodFrequency = readUintLE(data, 24, 8);
  if (periodFrequency !== 0n) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} has an active fee time scheduler (period_frequency=${periodFrequency}); only static base fees are quotable in-VM`,
    );
  }
  const cliffFeeNumerator = readUintLE(data, 8, 8);
  const maxFeeNumerator = data[486] === 0 ? MAX_FEE_NUMERATOR_V0 : MAX_FEE_NUMERATOR_V1;
  if (cliffFeeNumerator > maxFeeNumerator) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} cliff_fee_numerator ${cliffFeeNumerator} exceeds the fee cap ${maxFeeNumerator}`,
    );
  }
  const sqrtMinPrice = readUintLE(data, 424, 16);
  const sqrtMaxPrice = readUintLE(data, 440, 16);
  const sqrtPrice = readUintLE(data, 456, 16);
  // The program validates these bands at pool init; re-checking them makes
  // the in-VM overflow bound (sqrt prices < 2^97) unconditional.
  if (sqrtMinPrice < MIN_SQRT_PRICE || sqrtMaxPrice > MAX_SQRT_PRICE) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} sqrt price band [${sqrtMinPrice}, ${sqrtMaxPrice}] escapes the program band [${MIN_SQRT_PRICE}, ${MAX_SQRT_PRICE}]`,
    );
  }
  if (sqrtPrice < sqrtMinPrice || sqrtPrice > sqrtMaxPrice) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} sqrt_price ${sqrtPrice} is outside its band [${sqrtMinPrice}, ${sqrtMaxPrice}]`,
    );
  }
  const liquidity = readUintLE(data, 360, 16);
  if (liquidity === 0n) {
    throw new Error(`meteora-damm-v2 pool ${pool} has zero liquidity`);
  }
  return {
    cliffFeeNumerator,
    collectFeeMode,
    maxFeeNumerator,
    dynamicFee:
      data[56] === 1
        ? { binStep: readUintLE(data, 72, 2), variableFeeControl: readUintLE(data, 68, 4) }
        : null,
    volatilityAccumulator: readUintLE(data, 120, 16),
    tokenAMint: pubkeyAt(data, 168),
    tokenBMint: pubkeyAt(data, 200),
    tokenAVault: pubkeyAt(data, 232),
    tokenBVault: pubkeyAt(data, 264),
    tokenAFlag: data[482],
    tokenBFlag: data[483],
    activationPoint: readUintLE(data, 472, 8),
    activationType: data[480],
    sqrtMinPrice,
    sqrtMaxPrice,
    sqrtPrice,
    liquidity,
  };
}

function dammV2Config(cfg: PoolConfig): MeteoraDammV2PoolConfig {
  if (cfg.venue !== SLUG) {
    throw new Error(`meteora-damm-v2 adapter got a config for venue '${cfg.venue}'`);
  }
  const c = cfg as MeteoraDammV2PoolConfig;
  if (c.direction !== 'aToB' && c.direction !== 'bToA') {
    throw new Error(`meteora-damm-v2 direction must be 'aToB' or 'bToA', got '${c.direction}'`);
  }
  return c;
}

function checkAmountIn(construct: string, amountIn: bigint): void {
  if (amountIn <= 0n || amountIn > U64_MAX) {
    throw new Error(`${construct} amountIn must be a positive u64, got ${amountIn}`);
  }
}

function tokenProgramFor(pool: string, side: string, flag: number): Address {
  if (flag === 0) return TOKEN_PROGRAM;
  if (flag === 1) return TOKEN_2022_PROGRAM;
  throw new Error(`meteora-damm-v2 pool ${pool} token_${side}_flag=${flag} is not a known token program flag`);
}

/**
 * Token-2022 transfer-fee gate: a TransferFeeConfig extension makes wire
 * amounts diverge from the pool math, so such pools are rejected. Mint TLV:
 * 82-byte base, zero padding to 165, account type byte at 165, then
 * [type u16 LE][len u16 LE][data] entries; TransferFeeConfig is type 1.
 */
async function assertNoTransferFee(load: AccountLoader, pool: string, side: string, mint: Address): Promise<void> {
  const data = await load(mint);
  if (data === null) {
    throw new Error(
      `meteora-damm-v2 pool ${pool} token_${side} mint ${mint} not found (required to inspect token-2022 extensions)`,
    );
  }
  if (data.length <= 166) return; // base mint, no extensions
  let offset = 166;
  while (offset + 4 <= data.length) {
    const type = readUintLE(data, offset, 2);
    if (type === 0n) break; // uninitialized padding
    if (type === 1n) {
      throw new Error(
        `meteora-damm-v2 pool ${pool} token_${side} mint ${mint} has a token-2022 transfer-fee extension`,
      );
    }
    offset += 4 + Number(readUintLE(data, offset + 2, 2));
  }
}

/**
 * total_fee_numerator = min(base + variable, cap). Base is static (scheduler
 * pools are gated); variable uses the STORED volatility accumulator, the
 * documented approximation (docs/svm-venues.md) that is exact within
 * filter_period.
 */
function totalFeeNumerator(d: DecodedPool): bigint {
  let fee = d.cliffFeeNumerator;
  if (d.dynamicFee !== null) {
    const scaled = d.volatilityAccumulator * d.dynamicFee.binStep;
    fee += ceilDiv(scaled * scaled * d.dynamicFee.variableFeeControl, 100_000_000_000n);
  }
  return fee > d.maxFeeNumerator ? d.maxFeeNumerator : fee;
}

export const meteoraDammV2 = {
  slug: SLUG,
  kind: 'sqrt-price',
  programId: PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<MeteoraDammV2PoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`meteora-damm-v2 pool ${pool} account not found`);
    const d = decodePool(pool, data);
    // A slot-typed activation point cannot be evaluated against the unix
    // clock off-chain nor in the fragment; every settled pool carries 0.
    if (d.activationType === 0 && d.activationPoint !== 0n) {
      throw new Error(
        `meteora-damm-v2 pool ${pool} has slot-based activation_point ${d.activationPoint} — slot-gated pools are out of scope`,
      );
    }
    const tokenAProgram = tokenProgramFor(pool, 'a', d.tokenAFlag);
    const tokenBProgram = tokenProgramFor(pool, 'b', d.tokenBFlag);
    if (d.tokenAFlag === 1) await assertNoTransferFee(load, pool, 'a', d.tokenAMint);
    if (d.tokenBFlag === 1) await assertNoTransferFee(load, pool, 'b', d.tokenBMint);
    return {
      venue: SLUG,
      pool,
      direction: 'aToB',
      tokenAMint: d.tokenAMint,
      tokenBMint: d.tokenBMint,
      tokenAVault: d.tokenAVault,
      tokenBVault: d.tokenBVault,
      tokenAProgram,
      tokenBProgram,
      collectFeeMode: d.collectFeeMode,
      cliffFeeNumerator: d.cliffFeeNumerator,
      maxFeeNumerator: d.maxFeeNumerator,
      dynamicFee: d.dynamicFee,
      activationPoint: d.activationPoint,
      activationType: d.activationType,
      sqrtMinPrice: d.sqrtMinPrice,
      sqrtMaxPrice: d.sqrtMaxPrice,
      liquidity: d.liquidity,
      sqrtPrice: d.sqrtPrice,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = dammV2Config(cfg);
    return [{ ref: c.pool, address: c.pool }];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = dammV2Config(cfg);
    if (!Number.isInteger(i) || i < 0) {
      throw new Error(`meteora-damm-v2 emitQuote index must be a non-negative integer, got ${i}`);
    }
    checkAmountIn('meteora-damm-v2 emitQuote', amountIn);
    const lines: string[] = [];
    // Account model (RS compiler): quoteAccounts() attaches the pool alone, so
    // the pool is slot 0 (acc0) and every on-chain read is `svm.sload(acc0, off,
    // w).toLe()`. Live reads: base fee numerator (u64 @8), liquidity (u128 @360)
    // and sqrt_price (u128 @456) change under trading; band bounds and dynamic-
    // fee config are immutable pool parameters and are baked as literals.
    if (c.dynamicFee === null) {
      lines.push(`const f${i} = svm.sload(acc0, 8, 8).toLe();`);
    } else {
      lines.push(
        `let f${i} = svm.sload(acc0, 8, 8).toLe();`,
        `const v${i} = svm.sload(acc0, 120, 16).toLe() * ${c.dynamicFee.binStep};`,
        `f${i} = f${i} + (v${i} * v${i} * ${c.dynamicFee.variableFeeControl} + 99999999999) / 100000000000;`,
        `if (f${i} > ${c.maxFeeNumerator}) { f${i} = ${c.maxFeeNumerator} }`,
      );
    }
    lines.push(`const l${i} = svm.sload(acc0, 360, 16).toLe();`, `const s${i} = svm.sload(acc0, 456, 16).toLe();`);
    if (c.direction === 'aToB') {
      // next = ceil(L * sqrtP / (L + dIn * sqrtP)); delta_b floors; fee ceils
      // on OUTPUT (fees are never on input for aToB). A band-crossing next
      // clamps the quote to 0 (never wraps: next <= sqrtP here) so the other
      // venues in a multi-pool program stay quotable.
      lines.push(
        `const d${i} = l${i} + ${amountIn} * s${i};`,
        `const n${i} = (l${i} * s${i} + d${i} - 1) / d${i};`,
        `const g${i} = (l${i} * (s${i} - n${i})) / ${Q128};`,
        `let q${i} = g${i} - (g${i} * f${i} + 999999999) / 1000000000;`,
        `if (n${i} < ${c.sqrtMinPrice}) { q${i} = 0 }`,
      );
    } else {
      // next = sqrtP + floor(dIn << 128 / L); delta_a floors; fee ceils on
      // INPUT for collect_fee_mode 1 (OnlyB), on output for mode 0. A
      // band-crossing next may wrap the g/q intermediates (see the header
      // bound) — the clamp to 0 discards them before use.
      const feesOnInput = c.collectFeeMode >= 1;
      const dIn = feesOnInput ? `a${i}` : `${amountIn}`;
      if (feesOnInput) {
        lines.push(`const a${i} = ${amountIn} - (${amountIn} * f${i} + 999999999) / 1000000000;`);
      }
      lines.push(
        `const n${i} = s${i} + (${dIn} * ${Q128}) / l${i};`,
        `const g${i} = (l${i} * (n${i} - s${i})) / (s${i} * n${i});`,
        feesOnInput
          ? `let q${i} = g${i};`
          : `let q${i} = g${i} - (g${i} * f${i} + 999999999) / 1000000000;`,
        `if (n${i} > ${c.sqrtMaxPrice}) { q${i} = 0 }`,
      );
    }
    // Timestamp-typed activation gates in-fragment (slot-typed nonzero points
    // are rejected at fetch); ctx.timestamp() is the Clock sysvar (RS spelling).
    if (c.activationType === 1 && c.activationPoint > 0n) {
      lines.push(`if (ctx.timestamp() < ${c.activationPoint}) { q${i} = 0 }`);
    }
    return lines.join('\n');
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = dammV2Config(cfg);
    checkAmountIn('meteora-damm-v2 buildSwap', amountIn);
    // discriminator || amount_in u64 LE || minimum_amount_out u64 LE — min_out
    // is 1 by contract (the recipe's post-swap delta check owns the bound).
    const data = new Uint8Array(24);
    data.set(SWAP_DISCRIMINATOR, 0);
    for (let b = 0; b < 8; b++) data[8 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[16] = 1;
    const fixed = (addr: Address, writable = false): VenueAccount =>
      writable ? { ref: addr, address: addr, writable: true } : { ref: addr, address: addr };
    return {
      programId: PROGRAM_ID,
      data,
      accounts: [
        fixed(POOL_AUTHORITY),
        fixed(c.pool, true),
        { ref: user.inAta, writable: true },
        { ref: user.outAta, writable: true },
        fixed(c.tokenAVault, true),
        fixed(c.tokenBVault, true),
        fixed(c.tokenAMint),
        fixed(c.tokenBMint),
        { ref: user.owner, signer: true },
        fixed(c.tokenAProgram),
        fixed(c.tokenBProgram),
        // Anchor-optional referral_token_account: the program id readonly is
        // the none-placeholder.
        fixed(PROGRAM_ID),
        fixed(EVENT_AUTHORITY),
        fixed(PROGRAM_ID),
      ],
    };
  },

  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint {
    const c = dammV2Config(cfg);
    const data = state[c.pool];
    if (data === undefined) throw new Error(`meteora-damm-v2 pool ${c.pool} missing from state`);
    checkAmountIn('meteora-damm-v2 referenceQuote', amountIn);
    const d = decodePool(c.pool, data);
    // Only timestamp-typed points compare against unix `now`; slot-typed
    // nonzero points never reach here (rejected at fetch).
    if (d.activationType === 1 && now < d.activationPoint) {
      throw new Error(
        `meteora-damm-v2 pool ${c.pool} not activated (activation_point=${d.activationPoint}, now=${now})`,
      );
    }
    const fee = totalFeeNumerator(d);
    const aToB = c.direction === 'aToB';
    // fees_on_input only for (OnlyB | Compounding) + bToA; compounding is gated.
    const feesOnInput = !aToB && d.collectFeeMode >= 1;
    let dIn = amountIn;
    if (feesOnInput) dIn -= ceilDiv(dIn * fee, FEE_DENOMINATOR);
    const L = d.liquidity;
    const sp = d.sqrtPrice;
    let outGross: bigint;
    if (aToB) {
      const next = ceilDiv(L * sp, L + dIn * sp); // rounds UP: price moves down
      // Band violations mirror the fragment's clamp so the triangle invariant
      // (in-VM == reference) holds and the other venues stay quotable.
      if (next < d.sqrtMinPrice) return 0n;
      outGross = (L * (sp - next)) >> 128n; // delta_b, rounds DOWN
    } else {
      const next = sp + (dIn << 128n) / L; // rounds DOWN: price moves up
      if (next > d.sqrtMaxPrice) return 0n;
      outGross = (L * (next - sp)) / (sp * next); // delta_a, rounds DOWN
    }
    return feesOnInput ? outGross : outGross - ceilDiv(outGross * fee, FEE_DENOMINATOR);
  },
} satisfies SvmVenueAdapter;
