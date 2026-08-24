/**
 * Hylo Exchange — a mint/redeem stablecoin venue on Solana, program
 * HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn. hyUSD is minted/redeemed
 * against USDC 1:1-by-USD-value (fee + oracle adjusted) through a SINGLE
 * global `UsdcPair` account — there is no per-pair pool to discover: the
 * `Hylo`, `UsdcPair`, vault and Pyth-feed addresses are all deterministic
 * PDAs/constants of the immutable program id (see PDA DERIVATION below), so
 * this family is a SINGLETON, not a scanned-by-mint universe like every
 * other SVM family here (see discovery.ts's `knownAddresses` mechanism this
 * venue is the first to need).
 *
 * SOURCE: this program's own on-chain Anchor IDL (fetched from the IDL PDA:
 * `createAddressWithSeed(findProgramAddress([], programId), "anchor:idl",
 * programId)`, 15,980 bytes, 150,227 decompressed) for every account layout
 * and instruction shape, cross-checked byte-for-byte against the OPEN-SOURCE
 * `hylo-so/sdk` Rust workspace (`hylo-core`/`hylo-quotes`, github.com/hylo-so/sdk,
 * MIT-style public repo — unlike Perena/SolFi this venue's quote math has a
 * real, public reference implementation, so this port is a DIRECT transliteration
 * of `hylo-core::exchange_math`/`conversion::UsdcStablecoinConversion`/
 * `fees::controller::FeeExtract`/`pyth::query_pyth_price` and
 * `hylo-quotes::token_operation::exchange`'s `TokenOperation<USDC,HYUSD>` /
 * `TokenOperation<HYUSD,USDC>` impls — NOT a reverse-engineered approximation,
 * so (unlike Perena's disclosed MARGIN_BPS haircut) this quote is EXACT, no
 * safety margin needed; see hylo.test.ts for the byte-identical validation
 * against the real accounts and hylo-core's own fixed-point (`fix` crate)
 * semantics (`Fix<Bits,Base=10,Exp>`: value = bits · 10^Exp; `mul_div_floor`
 * = floor(a·b/c); `checked_convert` between exponents = floor/exact-scale).
 *
 * SCOPE (disclosed): only the USDC<->hyUSD leg (`mint_stablecoin_usdc` /
 * `redeem_stablecoin_usdc`), NOT the LST<->hyUSD or exogenous-collateral
 * (`ExoPair`, cbBTC) legs, and NOT the xSOL levercoin mint/redeem/swap
 * instructions — those need a SOL/USD (or BTC/USD) Pyth feed plus the
 * protocol-wide collateral-ratio machinery (`Hylo.stablecoin_mint_threshold`,
 * `total_sol_cache`) that genuinely does not apply to this leg (see GATES
 * below for why). USDC<->hyUSD is the highest-liquidity, simplest-to-verify
 * leg and is a real, complete, standalone venue integration on its own.
 *
 * GATES — THE PLAN'S "collateral-ratio threshold" DOES NOT APPLY TO THIS LEG
 * (correcting the assumption at design time): `Hylo.stablecoin_mint_threshold`
 * (offset 365, a `UFixValue64`) feeds `exchange_math::max_mintable_stablecoin`,
 * which is used ONLY by the LST/exogenous mint routes
 * (`TokenOperation<L,HYUSD>::max_input_ungated` in hylo-quotes'
 * `token_operation/exchange.rs`) — never by `TokenOperation<USDC,HYUSD>` /
 * `TokenOperation<HYUSD,USDC>`, whose `preconditions()` is just
 * `usdc_pair_gates()` (protocol_paused + UsdcPair.paused, no CR check at all).
 * The real self-drop surface for the USDC leg is: (1) LIVE PAUSE state
 * (`Hylo.protocol_paused` @478 OR `UsdcPair.paused` @45 — recoverable,
 * `SvmWindowDriftError`); (2) the USDC/USD Pyth oracle's OWN validity —
 * `VerificationLevel::Full`, `publish_time` within `UsdcPair.oracle_interval_secs`
 * of `now` (recoverable staleness), and `conf/price <= UsdcPair.oracle_conf_tolerance`
 * (recoverable confidence blowout) — mirroring `hylo_core::pyth::query_pyth_oracle`
 * exactly EXCEPT the `posted_slot` sub-check (that needs the live SLOT, not the
 * unix `now` this family's `gate(cfg, now)` hook receives — a disclosed,
 * narrower-than-the-real-gate residual: a feed could pass this staleness check
 * on `publish_time` alone while failing the real program's `posted_slot` check,
 * in which case the real CPI reverts loudly rather than silently mispricing —
 * no fund-safety gap, just a slightly less proactive self-drop); and
 * (3) the REDEEM leg's two REAL on-chain caps — `UsdcPair.virtual_stablecoin.supply`
 * (a burn-underflow revert bound) and the USDC collateral vault's live SPL
 * balance (an insufficient-liquidity revert bound) — both enforced as a
 * CAPACITY CLAMP on the ladder (see CAPACITY below), not a prepare-time
 * self-drop, because they are amount-DEPENDENT, not pool-state-dependent.
 * The MINT leg has NO practical cap (`max_input_ungated` is
 * `UFix64::<N9>(u64::MAX).convert::<N6>()`, an arithmetic-safety bound only —
 * so `emitSetup` bakes an UNCAPPED sentinel for `aToB`, matching this ladder
 * interface's own "disabled clamp is a no-op" convention (see obric-v2's
 * `icap` default).
 *
 * MATH (exact, from `hylo-core`):
 *   MINT (aToB, USDC amount x, 6dp -> hyUSD, 6dp):
 *     usdcInN9  = x * 1000                          // N6->N9, exact (checked_convert)
 *     remainN9  = floor(usdcInN9 * (10000-fee) / 10000)   // FeeExtract, fee is UFix64<N4>
 *     outN9     = floor(remainN9 * priceLowerN9 / 1e9)    // UsdcStablecoinConversion::deposit_to_stablecoin
 *     out       = floor(outN9 / 1000)               // N9->N6
 *   (fees_extracted = usdcInN9 - remainN9 is not separately needed — see
 *   the module-header note on `FeeExtract::split`'s algebraic identity
 *   `a - ceil(a·fee/D) == floor(a·(D-fee)/D)` for nonnegative integer a,
 *   fee, D — lets this port use ONLY the floored `Math.mulDiv` intrinsic the
 *   SVM codegen exposes, with no separate ceil primitive.)
 *
 *   REDEEM (bToA, hyUSD amount x, 6dp -> USDC, 6dp), CAPACITY-CLAMPED at `icap`
 *   (the tighter of the vsupply-implied and vault-implied input caps, see
 *   CAPACITY below) before evaluating:
 *     remainN6  = floor(x * (10000-fee) / 10000)     // FeeExtract, gates BurnUnderflow
 *     remainN9  = remainN6 * 1000
 *     outN9     = floor(remainN9 * 1e9 / priceUpperN9)    // stablecoin_to_withdrawal
 *     out       = floor(outN9 / 1000)
 *
 *   priceLowerN9 = (priceRaw - confRaw) * priceScale, priceUpperN9 = (priceRaw
 *   + confRaw) * priceScale — `PriceRange::from_conf`, using the LIVE price/conf
 *   words (read every trade) but a `priceScale` (= 10^(9-|exponent|)) BAKED at
 *   prepare time from the feed's exponent (a Pyth exponent is metadata that
 *   essentially never changes trade-to-trade — the same "immutable curve
 *   constant, baked once" treatment this repo's other closed-form ladders give
 *   their own pool constants, e.g. perena.ts's WAD rescale).
 *
 * CAPACITY (redeem only — exact inverse-floor derivation, proven by brute-force
 * sweep in hylo.test.ts): the largest `remaining` R for which
 * `floor(R/1000*1e9/P)/1000 <= V` (the vault cap) is
 * `rMaxForVault(V,P) = floor(((V+1)*P - 1) / 1e9)`, and the largest raw input
 * `in` for which `floor(in*(D-fee)/D) <= target` (either `vsupply` or the
 * vault-implied `rMaxForVault` above) is
 * `maxInForRemainingCap(target,fee) = floor(((target+1)*D - 1) / (D-fee))`
 * — both from the integer identity `floor(y/D) <= W  <=>  y < (W+1)*D`. The
 * ladder's `icap` is the MIN of the two `maxInForRemainingCap` results. This
 * is a real, exact liquidity cap (unlike most other families' CP/stable
 * curves, which self-limit asymptotically) — Hylo's redeem is LINEAR pre-cap,
 * so without an explicit clamp the curve would promise more than the real
 * vault/burn-underflow bound can deliver past the cap (a REVERT of the whole
 * cook, not a graceful shortfall) — capped, the curve is linear-then-flat,
 * which is monotone and concave (as required).
 *
 * PDA DERIVATION (all fixed, no RPC needed to compute — only to READ their
 * data): `hylo` = PDA(["hylo"]); `usdc_pair` = PDA(["usdc_pair"]);
 * `stablecoin_mint` (hyUSD) = PDA(["hyUSD"]); `stablecoin_auth` =
 * PDA(["mint_auth", stablecoin_mint]); `usdc_vault_auth` =
 * PDA(["usdc_vault_auth", USDC_MINT]); `usdc_fee_auth` = PDA(["fee_auth",
 * USDC_MINT]); `stablecoin_fee_auth` = PDA(["fee_auth", stablecoin_mint]);
 * `event_authority` = PDA(["__event_authority"]) — all seeded off this
 * program id. The three token VAULTS are plain Associated Token Accounts of
 * their respective auth PDAs (`usdc_collateral_vault` = ATA(usdc_vault_auth,
 * USDC_MINT), etc.) — every one of these 11 derived addresses was confirmed
 * against real mainnet reads (correct owner + expected account size) when
 * this venue was integrated.
 *
 * CPI: `mint_stablecoin_usdc` (disc 0e0ea31ae0b69f9b) / `redeem_stablecoin_usdc`
 * (disc aaed62683c5248a1) — `amount: u64` (runtime-patched) + `slippage_config:
 * Option<SlippageConfig>` encoded as `None` (a single 0x00 byte): this venue's
 * own optional client-side slippage guard is unused, exactly like every other
 * venue's `min_out=1` convention — the recipe's own terminal outAta delta
 * check is the real floor. Both instructions share IDENTICAL 18-account
 * lists/order (same on-chain Anchor Accounts struct); direction only swaps
 * which of `user_stablecoin_ta`/`user_usdc_ta` is the caller's in/out ATA.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountBytesMap, AccountLoader, PoolConfig, SvmVenueAdapter, SwapUser, VenueAccount, VenueSwap } from '../types.js';

const SLUG = 'hylo';
export const HYLO_PROGRAM_ID = address('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
/** PDA(["hyUSD"], HYLO_PROGRAM_ID). */
export const HYUSD_MINT = address('5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E');
/** PDA(["hylo"], HYLO_PROGRAM_ID) — the program's singleton config account. */
export const HYLO_ACCOUNT = address('9cd2sAfbBvKs4SX9YKo4dcjwP3TgTVQ8dT5koshGcDND');
/** PDA(["usdc_pair"], HYLO_PROGRAM_ID) — the singleton USDC<->hyUSD pair account (this venue's `pool`). */
export const USDC_PAIR_ACCOUNT = address('CMNPACEDebyvNJDgBxRc5fbScF8kmx52ZPBY4Cu4wuwS');
/** PDA(["mint_auth", HYUSD_MINT]). */
const STABLECOIN_AUTH = address('CfuSViqf6wvUKEprLhtuCsSanvfAsMbDmkAW92FP95qe');
/** PDA(["usdc_vault_auth", USDC_MINT]). */
const USDC_VAULT_AUTH = address('FVVUPkXtkiwYz8epMSGMgNwZNVKcyyWfN9iQSJ9z5SX4');
/** PDA(["fee_auth", USDC_MINT]). */
const USDC_FEE_AUTH = address('39ACqviD7R5XyGBcwwV1YVru4uvSmz5Pgt7S9RxPRPkL');
/** PDA(["fee_auth", HYUSD_MINT]). */
const STABLECOIN_FEE_AUTH = address('3HT6dD6APJh89XJs9rkn3BmsvkXE9jPG9dWJmUjWu6TS');
/** ATA(USDC_VAULT_AUTH, USDC_MINT) — the real USDC collateral backing hyUSD minted via this leg. */
export const USDC_COLLATERAL_VAULT = address('5ykRvDpEXwKEdoE6yfZ45zeuZ62CcRQRUoZoye4tTJd7');
/** ATA(USDC_FEE_AUTH, USDC_MINT). */
const USDC_FEE_VAULT = address('Bz6Xsr7vTo2oSFxjmJVpoC4bVNGVpP5egbdVk4Jeu1JZ');
/** ATA(STABLECOIN_FEE_AUTH, HYUSD_MINT). */
const STABLECOIN_FEE_VAULT = address('Hh8N3Fdauxgq1jjcKdzGBR3D8cdkpLZrFEVumL1tYQLp');
/** PDA(["__event_authority"], HYLO_PROGRAM_ID) — Anchor's emit_cpi! self-invoke authority. */
const EVENT_AUTHORITY = address('4VzpNE51Be5vD5Yg8MC3z6TVHq5gGbLJptjv18QbD6WP');
/** The live USDC/USD Pyth push-oracle account (pyth-solana-receiver PriceUpdateV2), program-agnostic. */
export const USDC_USD_PYTH_FEED = address('6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT');

/** sha256('global:mint_stablecoin_usdc')[0..8]. */
const MINT_STABLECOIN_USDC_DISCRIMINATOR = Uint8Array.from([14, 14, 163, 26, 224, 182, 159, 155]);
/** sha256('global:redeem_stablecoin_usdc')[0..8]. */
const REDEEM_STABLECOIN_USDC_DISCRIMINATOR = Uint8Array.from([170, 237, 98, 104, 60, 82, 72, 161]);
/** Option<SlippageConfig>::None — this venue's own optional slippage guard, unused (see module header CPI). */
const SLIPPAGE_CONFIG_NONE = Uint8Array.from([0]);

// ---- Hylo account (511 bytes incl. 8-byte disc) — offsets IDL-derived, see module header ----
export const HYLO_ACCOUNT_SIZE = 511;
/** sha256('account:Hylo')[0..8]. */
export const HYLO_DISCRIMINATOR = [0x72, 0xa1, 0xa9, 0xd2, 0xcc, 0xaf, 0x95, 0xae];
const OFF_HYLO_PROTOCOL_PAUSED = 478;

// ---- UsdcPair account (173 bytes incl. 8-byte disc) ----
export const USDC_PAIR_ACCOUNT_SIZE = 173;
/** sha256('account:UsdcPair')[0..8]. */
export const USDC_PAIR_DISCRIMINATOR = [0x82, 0x61, 0xc2, 0x4e, 0x16, 0xfe, 0x89, 0x6b];
const OFF_SWAP_FEE_BITS = 10; // UFixValue64 { bits: u64 @10..18, exp: i8 @18 } — exp is always -4 (N4, bps)
const OFF_ORACLE_INTERVAL_SECS = 19; // u64
const OFF_ORACLE_CONF_TOLERANCE_BITS = 27; // UFixValue64 { bits @27..35, exp @35 } — always -9 (N9)
const OFF_VIRTUAL_STABLECOIN_SUPPLY_BITS = 36; // UFixValue64 { bits @36..44, exp @44 } — always -6 (N6)
const OFF_USDC_PAIR_PAUSED = 45;

// ---- PriceUpdateV2 (pyth-solana-receiver) — offsets confirmed against the real USDC/USD feed account ----
const OFF_PYTH_VERIFICATION_LEVEL = 40; // enum tag: 0=Partial(+1 byte), 1=Full
const OFF_PYTH_PRICE = 73; // i64 (always read as accountUint — self-dropped if <= 0, see GATES)
const OFF_PYTH_CONF = 81; // u64
const OFF_PYTH_EXPONENT = 89; // i32 — read ONCE at fetch time only (see module header MATH)
const OFF_PYTH_PUBLISH_TIME = 93; // i64

// ---- SPL token account (collateral vault) ----
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64; // u64, no discriminator prefix (native SPL layout)

const N4_ONE = 10_000n;
const N9_ONE = 1_000_000_000n;
const N6_TO_N9 = 1_000n;
/** floor(a*b/c), 0 on a non-positive denominator (mirrors the engine's Math.mulDiv/DIV rule). */
function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  return c <= 0n ? 0n : (a * b) / c;
}

/**
 * Largest integer `in` such that `floor(in*(D-fee)/D) <= target` — the exact
 * inverse of the `FeeExtract` floor, from `floor(y/D) <= W <=> y < (W+1)*D`
 * (see module header CAPACITY). `fee` must be `< D`; callers guard this.
 */
function maxInForRemainingCap(target: bigint, fee: bigint, denom: bigint = N4_ONE): bigint {
  const kept = denom - fee;
  if (kept <= 0n) return 0n;
  return ((target + 1n) * denom - 1n) / kept;
}

/**
 * Largest `remaining` (N6, post-fee hyUSD) for which the resulting USDC
 * withdrawal stays `<= vaultBalance` (N6) at price `priceUpperN9` — the
 * exact inverse of `stablecoin_to_withdrawal`'s double floor (see module
 * header CAPACITY).
 */
function maxRemainingForVault(vaultBalance: bigint, priceUpperN9: bigint): bigint {
  if (priceUpperN9 <= 0n) return 0n;
  const r = ((vaultBalance + 1n) * priceUpperN9 - 1n) / N9_ONE;
  return r < 0n ? 0n : r;
}

export interface HyloPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'aToB': mint (USDC in -> hyUSD out). 'bToA': redeem (hyUSD in -> USDC out). */
  direction: 'aToB' | 'bToA';
  /** 10^(9-|exponent|) — baked from the Pyth feed's exponent at fetch time (see module header MATH). */
  priceScale: bigint;
  /** Prepare-time snapshot — see module header GATES; `gate()` re-derives freshness from these. */
  protocolPausedAtFetch: boolean;
  pairPausedAtFetch: boolean;
  verificationTagAtFetch: number;
  priceRawAtFetch: bigint;
  confRawAtFetch: bigint;
  publishTimeAtFetch: bigint;
  intervalSecsAtFetch: bigint;
  confToleranceBitsAtFetch: bigint;
}

function asHyloConfig(cfg: PoolConfig): HyloPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder/adapter got a '${cfg.venue}' pool config`);
  return cfg as HyloPoolConfig;
}

/**
 * Decodes the three fixed singleton accounts (Hylo config, the UsdcPair, and
 * the live USDC/USD Pyth feed) plus the USDC collateral vault's SPL balance.
 * `pool` MUST be {@link USDC_PAIR_ACCOUNT} — this family has no other pool
 * (see module header — a SINGLETON, not a scanned universe).
 */
async function fetchPoolConfig(load: AccountLoader, pool: Address): Promise<HyloPoolConfig> {
  if (pool !== USDC_PAIR_ACCOUNT) {
    throw new Error(`${SLUG} only serves the singleton pair ${USDC_PAIR_ACCOUNT}, got ${pool}`);
  }
  const [hyloData, pairData, pythData, vaultData] = await Promise.all([
    load(HYLO_ACCOUNT),
    load(USDC_PAIR_ACCOUNT),
    load(USDC_USD_PYTH_FEED),
    load(USDC_COLLATERAL_VAULT),
  ]);
  if (hyloData === null) throw new Error(`${SLUG} Hylo config account ${HYLO_ACCOUNT} not found`);
  if (pairData === null) throw new Error(`${SLUG} UsdcPair account ${USDC_PAIR_ACCOUNT} not found`);
  if (pythData === null) throw new Error(`${SLUG} USDC/USD Pyth feed ${USDC_USD_PYTH_FEED} not found`);
  if (vaultData === null) throw new Error(`${SLUG} USDC collateral vault ${USDC_COLLATERAL_VAULT} not found`);

  if (hyloData.length !== HYLO_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} Hylo account has unexpected size ${hyloData.length} (want ${HYLO_ACCOUNT_SIZE})`);
  }
  for (let i = 0; i < 8; i++) {
    if (hyloData[i] !== HYLO_DISCRIMINATOR[i]) throw new Error(`${SLUG} Hylo account has a wrong discriminator`);
  }
  if (pairData.length !== USDC_PAIR_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} UsdcPair account has unexpected size ${pairData.length} (want ${USDC_PAIR_ACCOUNT_SIZE})`);
  }
  for (let i = 0; i < 8; i++) {
    if (pairData[i] !== USDC_PAIR_DISCRIMINATOR[i]) throw new Error(`${SLUG} UsdcPair account has a wrong discriminator`);
  }

  const exponentBits = Number(readUintLE(pythData, OFF_PYTH_EXPONENT, 4) & 0xffffffffn);
  // exponent is stored i32 LE; the field is always small-magnitude and negative for a real
  // feed, so re-interpret the raw 32-bit pattern as signed.
  const signedExponent = exponentBits >= 0x80000000 ? exponentBits - 0x100000000 : exponentBits;
  if (signedExponent < -9 || signedExponent > -2) {
    throw new Error(`${SLUG} USDC/USD feed has an unsupported exponent ${signedExponent} (want -9..-2)`);
  }
  const priceScale = 10n ** BigInt(9 + signedExponent);

  return {
    venue: SLUG,
    pool,
    direction: 'aToB',
    priceScale,
    protocolPausedAtFetch: hyloData[OFF_HYLO_PROTOCOL_PAUSED] !== 0,
    pairPausedAtFetch: pairData[OFF_USDC_PAIR_PAUSED] !== 0,
    verificationTagAtFetch: pythData[OFF_PYTH_VERIFICATION_LEVEL],
    priceRawAtFetch: readUintLE(pythData, OFF_PYTH_PRICE, 8),
    confRawAtFetch: readUintLE(pythData, OFF_PYTH_CONF, 8),
    publishTimeAtFetch: readUintLE(pythData, OFF_PYTH_PUBLISH_TIME, 8),
    intervalSecsAtFetch: readUintLE(pairData, OFF_ORACLE_INTERVAL_SECS, 8),
    confToleranceBitsAtFetch: readUintLE(pairData, OFF_ORACLE_CONF_TOLERANCE_BITS, 8),
  } satisfies HyloPoolConfig;
}

/**
 * Prepare-time SELF-DROP gate (see module header GATES): pause state (recoverable) and the
 * USDC/USD Pyth oracle's own validity (verification level, confidence, staleness vs `now` —
 * mirrors `hylo_core::pyth::query_pyth_oracle` except the `posted_slot` sub-check, which needs
 * the live SLOT this hook does not receive — disclosed narrower-than-real-gate residual). All
 * from the FETCH-TIME snapshot (this hook has no loader) — a live CPI still enforces the real,
 * current state regardless (SVM execution-time re-check is a platform impossibility).
 */
export function hyloGate(cfg: PoolConfig, now: bigint): void {
  const c = asHyloConfig(cfg);
  if (c.protocolPausedAtFetch) throw new SvmHyloDriftError(`${SLUG}: protocol is paused (snapshot at fetch time)`);
  if (c.pairPausedAtFetch) throw new SvmHyloDriftError(`${SLUG}: USDC pair is paused (snapshot at fetch time)`);
  if (c.verificationTagAtFetch !== 1) {
    throw new SvmHyloDriftError(`${SLUG}: USDC/USD oracle is not fully verified (snapshot at fetch time)`);
  }
  if (c.priceRawAtFetch <= 0n) throw new SvmHyloDriftError(`${SLUG}: USDC/USD oracle price is non-positive`);
  if (c.confRawAtFetch * N9_ONE > c.confToleranceBitsAtFetch * c.priceRawAtFetch) {
    throw new SvmHyloDriftError(`${SLUG}: USDC/USD oracle confidence exceeds tolerance`);
  }
  if (c.publishTimeAtFetch < 0n || c.publishTimeAtFetch > now || c.publishTimeAtFetch + c.intervalSecsAtFetch < now) {
    throw new SvmHyloDriftError(`${SLUG}: USDC/USD oracle is stale (publish_time outside the interval)`);
  }
}

/**
 * Recoverable live-state drift (pause / stale-or-low-confidence oracle) between discovery and
 * prepare — the SAME class `the consuming app SVM solver entry`'s own `SvmWindowDriftError` names (that class
 * is private to index.ts, so this venue module carries an identically-treated local marker;
 * `the consuming app SVM solver entry`'s FAMILIES wiring re-throws this as its own `SvmWindowDriftError` so the
 * self-drop classification stays centralized there).
 */
export class SvmHyloDriftError extends Error {}

/** Live oracle + pair state a quote needs — read fresh (not cached) every trade. */
interface HyloLiveState {
  feeBits: bigint; // N4
  vsupply: bigint; // N6
  priceRaw: bigint;
  confRaw: bigint;
  vaultBalance: bigint; // N6, only meaningful for the redeem direction
}

function liveStateFrom(state: AccountBytesMap): HyloLiveState {
  const pair = state[USDC_PAIR_ACCOUNT];
  const pyth = state[USDC_USD_PYTH_FEED];
  const vault = state[USDC_COLLATERAL_VAULT];
  if (pair === undefined) throw new Error(`${SLUG} reference is missing ${USDC_PAIR_ACCOUNT}`);
  if (pyth === undefined) throw new Error(`${SLUG} reference is missing ${USDC_USD_PYTH_FEED}`);
  if (vault === undefined) throw new Error(`${SLUG} reference is missing ${USDC_COLLATERAL_VAULT}`);
  return {
    feeBits: readUintLE(pair, OFF_SWAP_FEE_BITS, 8),
    vsupply: readUintLE(pair, OFF_VIRTUAL_STABLECOIN_SUPPLY_BITS, 8),
    priceRaw: readUintLE(pyth, OFF_PYTH_PRICE, 8),
    confRaw: readUintLE(pyth, OFF_PYTH_CONF, 8),
    vaultBalance: readUintLE(vault, TOKEN_ACCOUNT_AMOUNT_OFFSET, 8),
  };
}

/** TS mirror of the emitted mint (aToB) fragment. */
export function hyloMintOut(live: HyloLiveState, priceScale: bigint, x: bigint): bigint {
  if (x <= 0n) return 0n;
  const { feeBits, priceRaw, confRaw } = live;
  if (feeBits >= N4_ONE) return 0n;
  if (priceRaw <= confRaw) return 0n; // PriceRange::from_conf underflow guard
  const usdcInN9 = x * N6_TO_N9;
  const remainN9 = mulDivFloor(usdcInN9, N4_ONE - feeBits, N4_ONE);
  const priceLowerN9 = (priceRaw - confRaw) * priceScale;
  const outN9 = mulDivFloor(remainN9, priceLowerN9, N9_ONE);
  return outN9 / N6_TO_N9;
}

/** The redeem-direction input cap (see module header CAPACITY) — 0 when the pool is unquotable. */
export function hyloRedeemCapacity(live: HyloLiveState, priceScale: bigint): bigint {
  const { feeBits, priceRaw, confRaw, vsupply, vaultBalance } = live;
  if (feeBits >= N4_ONE) return 0n;
  if (priceRaw <= confRaw) return 0n;
  const priceUpperN9 = (priceRaw + confRaw) * priceScale;
  const cap1 = maxInForRemainingCap(vsupply, feeBits);
  const rMax = maxRemainingForVault(vaultBalance, priceUpperN9);
  const cap2 = maxInForRemainingCap(rMax, feeBits);
  return cap1 < cap2 ? cap1 : cap2;
}

/** TS mirror of the emitted redeem (bToA) fragment — `x` already clamped to the capacity above. */
export function hyloRedeemOut(live: HyloLiveState, priceScale: bigint, x: bigint): bigint {
  if (x <= 0n) return 0n;
  const { feeBits, priceRaw, confRaw } = live;
  if (feeBits >= N4_ONE) return 0n;
  if (priceRaw <= confRaw) return 0n;
  const priceUpperN9 = (priceRaw + confRaw) * priceScale;
  const remainN6 = mulDivFloor(x, N4_ONE - feeBits, N4_ONE);
  const remainN9 = remainN6 * N6_TO_N9;
  const outN9 = mulDivFloor(remainN9, N9_ONE, priceUpperN9);
  return outN9 / N6_TO_N9;
}

/**
 * Note: neither this nor the ladder's `quoteRefs` attaches {@link HYLO_ACCOUNT} — the quote
 * fragment never reads it live (`Hylo.protocol_paused` is a prepare-time-only self-drop via
 * `hyloGate`, see module header GATES), so attaching it here would waste an account slot for
 * nothing; it still rides the swap CPI's own account list (`swapAccounts`), which the real
 * on-chain instruction requires regardless.
 */
function quoteAccounts(_cfg: PoolConfig): VenueAccount[] {
  // The vault ref is fetched UNCONDITIONALLY (both directions) even though the mint direction's
  // ON-CHAIN fragment never reads it (see emitSetup) — depthReserves/continuousFees (the
  // off-chain relative-depth ranking, not the compiled bytecode) read it for BOTH directions, and
  // omitting it here for aToB would leave `state` missing the account those need at prepare time.
  return [
    { ref: `${SLUG}:pair`, address: USDC_PAIR_ACCOUNT },
    { ref: `${SLUG}:pyth`, address: USDC_USD_PYTH_FEED },
    { ref: `${SLUG}:vault`, address: USDC_COLLATERAL_VAULT },
  ];
}

function emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
  const c = asHyloConfig(cfg);
  const p = `h${i}`; // local-variable namespace for THIS call site (i-scoped)
  return [...readLines(c, p), ...arithmeticLines(c, p, p, String(amountIn), `q${i}`)].join('\n');
}

/**
 * The LIVE reads every rung/final quote shares, read ONCE per trade (matching
 * every other family's emitSetup/arithmetic split — see perena.ts's
 * `readLines` for the identical convention). `p` namespaces the LOCAL
 * VARIABLES only (call-site-scoped, so multiple `emitQuote` sites never
 * collide) — the ACCOUNT REFS below are the STABLE `${SLUG}:pair`/`:pyth`/
 * `:vault` names from `quoteAccounts` (this family has exactly one instance
 * of each, unlike a multi-pool family whose ref must key off the pool
 * address), so every call site shares one deduplicated account slot.
 */
function readLines(c: HyloPoolConfig, p: string): string[] {
  // Account model (RS/svm target): reads go through main()'s ordered `acc<k>`
  // params (k = the ref's index in quoteAccounts) — [pair=acc0, pyth=acc1,
  // vault=acc2] — not `accountUint("<ref>", …)`. `accountUint` lowered to
  // CAST_LE, so `.toLe()` is the exact endianness match.
  const pair = 'acc0';
  const pyth = 'acc1';
  const lines = [
    `  const ${p}fee = svm.sload(${pair}, ${OFF_SWAP_FEE_BITS}, 8).toLe();`,
    `  const ${p}price = svm.sload(${pyth}, ${OFF_PYTH_PRICE}, 8).toLe();`,
    `  const ${p}conf = svm.sload(${pyth}, ${OFF_PYTH_CONF}, 8).toLe();`,
  ];
  if (c.direction === 'bToA') {
    const vault = 'acc2';
    lines.push(
      `  const ${p}vsupply = svm.sload(${pair}, ${OFF_VIRTUAL_STABLECOIN_SUPPLY_BITS}, 8).toLe();`,
      `  const ${p}vault = svm.sload(${vault}, ${TOKEN_ACCOUNT_AMOUNT_OFFSET}, 8).toLe();`,
    );
  }
  return lines;
}

/** Statement lines computing `outVar` from expression `x`, referencing the already-read `p`-prefixed locals. */
function arithmeticLines(c: HyloPoolConfig, p: string, tmp: string, x: string, outVar: string): string[] {
  const scale = c.priceScale.toString();
  if (c.direction === 'aToB') {
    return [
      `  let ${outVar} = 0;`,
      `  if (${x} > 0 && ${p}fee < 10000 && ${p}price > ${p}conf) {`,
      `    const ${tmp}usdcInN9 = ${x} * 1000;`,
      `    const ${tmp}remainN9 = Math.mulDiv(${tmp}usdcInN9, 10000 - ${p}fee, 10000);`,
      `    const ${tmp}lowerN9 = (${p}price - ${p}conf) * ${scale};`,
      `    const ${tmp}outN9 = Math.mulDiv(${tmp}remainN9, ${tmp}lowerN9, 1000000000);`,
      `    ${outVar} = ${tmp}outN9 / 1000;`,
      '  }',
    ];
  }
  return [
    `  let ${outVar} = 0;`,
    `  if (${x} > 0 && ${p}fee < 10000 && ${p}price > ${p}conf) {`,
    `    const ${tmp}upperN9 = (${p}price + ${p}conf) * ${scale};`,
    `    const ${tmp}remainN6 = Math.mulDiv(${x}, 10000 - ${p}fee, 10000);`,
    `    const ${tmp}remainN9 = ${tmp}remainN6 * 1000;`,
    `    const ${tmp}outN9 = Math.mulDiv(${tmp}remainN9, 1000000000, ${tmp}upperN9);`,
    `    ${outVar} = ${tmp}outN9 / 1000;`,
    '  }',
  ];
}

/**
 * Ordered account list BOTH `mint_stablecoin_usdc` and `redeem_stablecoin_usdc` expect (one
 * shared Anchor Accounts struct — see module header CPI). `refFn(role)` supplies the ref for
 * every program-derived account (the plain adapter keys it by a fixed `hylo:<role>` string, the
 * ladder keys it by slot — matching every other family's `buildSwap`/`buildSwapV2` split, e.g.
 * perena.ts's `perenaAccounts`). The `pair`/`pyth`/`vault` roles are named to MATCH
 * `quoteAccounts`/`quoteRefs` exactly (same ref string) — those refs are shared, deduplicated
 * slots between the quote read and the CPI's own (writable) use of the same accounts, exactly
 * like perena.ts's `pool` ref.
 */
function swapAccounts(c: HyloPoolConfig, user: SwapUser, refFn: (role: string) => string): VenueAccount[] {
  const ro = (role: string, addr: Address): VenueAccount => ({ ref: refFn(role), address: addr });
  const rw = (role: string, addr: Address): VenueAccount => ({ ref: refFn(role), address: addr, writable: true });
  const userUsdcTa = c.direction === 'aToB' ? user.inAta : user.outAta;
  const userStablecoinTa = c.direction === 'aToB' ? user.outAta : user.inAta;
  return [
    { ref: user.owner, signer: true },
    ro('hylo', HYLO_ACCOUNT),
    rw('pair', USDC_PAIR_ACCOUNT),
    ro('stablecoinAuth', STABLECOIN_AUTH),
    ro('usdcVaultAuth', USDC_VAULT_AUTH),
    ro('usdcFeeAuth', USDC_FEE_AUTH),
    ro('stablecoinFeeAuth', STABLECOIN_FEE_AUTH),
    rw('vault', USDC_COLLATERAL_VAULT),
    rw('usdcFeeVault', USDC_FEE_VAULT),
    rw('stablecoinFeeVault', STABLECOIN_FEE_VAULT),
    { ref: userStablecoinTa, writable: true }, // user_stablecoin_ta
    { ref: userUsdcTa, writable: true }, // user_usdc_ta
    rw('stablecoinMint', HYUSD_MINT),
    ro('usdcMint', USDC_MINT),
    ro('pyth', USDC_USD_PYTH_FEED),
    ro('tokenProgram', TOKEN_PROGRAM),
    ro('eventAuthority', EVENT_AUTHORITY),
    ro('program', HYLO_PROGRAM_ID),
  ];
}

function buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
  const c = asHyloConfig(cfg);
  const disc = c.direction === 'aToB' ? MINT_STABLECOIN_USDC_DISCRIMINATOR : REDEEM_STABLECOIN_USDC_DISCRIMINATOR;
  const data = new Uint8Array(8 + 8 + 1);
  data.set(disc, 0);
  new DataView(data.buffer).setBigUint64(8, amountIn, true);
  data.set(SLIPPAGE_CONFIG_NONE, 16);
  return {
    programId: HYLO_PROGRAM_ID,
    data,
    accounts: swapAccounts(c, user, (role) => `${SLUG}:${role}`),
  };
}

/**
 * TS mirror of `emitQuote`/the ladder's cold quote — LAMPORT-EXACT to the on-chain fragment,
 * which performs NO pause/oracle-staleness check itself (that is a prepare-time-only self-drop
 * via `hyloGate`, see module header GATES) — only the fee/price sanity guards `hyloMintOut`/
 * `hyloRedeemOut` already carry, matching every field this reads live.
 */
function referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint): bigint {
  const c = asHyloConfig(cfg);
  const live = liveStateFrom(state);
  if (c.direction === 'aToB') return hyloMintOut(live, c.priceScale, amountIn);
  const cap = hyloRedeemCapacity(live, c.priceScale);
  return hyloRedeemOut(live, c.priceScale, amountIn > cap ? cap : amountIn);
}

export const hylo: SvmVenueAdapter = {
  slug: SLUG,
  kind: 'constant-product',
  programId: HYLO_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
  emitQuote,
  buildSwap,
  referenceQuote,
};

// ---- SvmVenueLadder (the SvmRoute production ladder) ----

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

