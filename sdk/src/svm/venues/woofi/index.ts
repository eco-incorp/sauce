/**
 * WooFi (Solana) venue adapter — the sPMM (synthetic proactive market maker)
 * family, EVM WooPPV2's Solana port (`WooFif76YGRNjk1pA8wCsN67aQsD9f9iLsz4NcJ1AVb`).
 * Source-verified against the audited Anchor program
 * (github.com/sherlock-audit/2024-08-woofi-solana-deployment,
 * `WOOFi_Solana/programs/woofi/src/{instructions/swap.rs,instructions/get_price.rs,
 * util/swap_math.rs,state/{wooracle,woopool}.rs}`) — the swap account list and
 * instruction data below were independently cross-checked against SIX real
 * mainnet swap transactions (Jupiter `Route`/`RouteV2` CPIs into this program,
 * 2026-07) before this adapter was written: every account role, its
 * writable/signer flag, and the `disc ++ from_amount(u128 LE) ++
 * min_to_amount(u128 LE)` instruction data all match byte-for-byte.
 *
 * DISCOVERY MODEL — the "WooAmmPool" bundle account (617 bytes; NOT part of
 * the audited source above — a newer/aggregator-facing convenience account
 * this deployment added so a pair's four constituent accounts are one RPC
 * read instead of four) is a PAIR wrapper: `wooracleA/woopoolA/tokenMintA/
 * tokenVaultA` for one token, the same four for a second token (`*B`), plus
 * `quoteTokenMint` (the deployment's single numeraire — USDC on this
 * deployment, live-verified: 6 live pools total, forming the complete C(4,2)
 * pairing of {SOL, USDT, one more SPL token, USDC}). It is NEVER itself an
 * account the swap CPI touches — purely a discovery convenience this adapter
 * decodes to recover the REAL WooPool/Wooracle/vault/mint addresses.
 *
 * SCOPE OF THIS ADAPTER (2026-07-31): only QUOTE-PAIRED pools — one side of
 * the bundle equal to `quoteTokenMint` — are wired (`sellBase` sells the
 * non-quote side for the quote; `sellQuote` is the reverse). Of the 6 live
 * bundles, 3 are quote-paired (SOL/USDC, USDT/USDC, the third token/USDC) and
 * fully modeled end to end (feasibility, math, and capacity, INCLUDING a
 * real, currently-live `OFF_POOL_RESERVE` floor this deployment's swap
 * checks — see that constant's doc; it reads 0 on this deployment's SOL and
 * USDC pools today, so those two specific pools correctly self-drop right
 * now rather than "are immediately tradeable"); the other 3 (SOL/USDT,
 * SOL/<third>, USDT/<third>) are genuine BASE-TO-BASE pairs. The real `Swap` instruction DOES support
 * base-to-base directly (three account tuples: from/to/quote-settlement —
 * `woopool_quote`/`quote_price_update`/`quote_token_vault` are ALWAYS present
 * even for a quote-paired trade, where they simply alias the quote-side's own
 * tuple — confirmed both by the Anchor account struct in swap.rs and by
 * every one of the 6 sampled real transactions, which showed the identical
 * trailing `[woopool, price_update, vault]` triple regardless of trade
 * direction). Wiring base-to-base is UNGATED BY PERMISSION — it needs no
 * whitelist, no approval — it is deferred here only because it needs a
 * FOURTH tuple (the quote-hub's own woopool/wooracle/vault/price_update),
 * which for a base-to-base bundle is NOT stored in that bundle account at
 * all (neither side is the quote) and this adapter does not yet resolve it
 * (fetch a sibling quote-paired bundle for either side, or derive the
 * WooPool PDA — `seeds = ["woopool", wooconfig, quoteMint, quoteMint, bump]`
 * — off-chain). Follow-up, not a permission gate.
 *
 * MATH (swap_math.rs, transcribed bit-for-bit into ladder.ts):
 *   sellBase:  calcA = floor(x*priceOut/priceDec)
 *              notional = floor(calcA*quoteDec/baseDec); gamma = floor(calcA*coeff/baseDec)
 *              quoteAmount = floor(floor(calcA*(1e18-gamma-spread)/1e18)*quoteDec/baseDec)
 *   sellQuote: gamma = floor(quoteAmount*coeff/quoteDec)
 *              baseAmount = floor(floor(floor(quoteAmount*baseDec*priceDec/priceOut)*(1e18-gamma-spread)/1e18)/quoteDec)
 *   fee (BOTH directions, ONCE, on the quote-denominated amount, ROUNDING UP —
 *   unlike the EVM port's truncating fee):
 *     swapFee = ceilDiv(quoteAmount*feeRate, 1e5); quoteAmount -= swapFee
 *   price_out (`get_price_impl`): a Pyth PriceUpdateV2 cross-price
 *   (`cloPrice = basePythPrice * 10^quoteExpAbs / quotePythPrice`, using ONLY
 *   the QUOTE feed's exponent for both — mirrored bit-for-bit even though
 *   that is only valid when both feeds share one exponent, true of every
 *   live pool here) gates the WooFi-keeper-posted `wooracle.price` by
 *   staleness (`now <= updatedAt + staleDuration`) and a `bound`-wide (WAD)
 *   band around cloPrice; if both pass, `price_out = wooracle.price`
 *   UNCHANGED (the keeper price, not cloPrice) — then a HARD range check
 *   (`rangeMin <= price_out <= rangeMax`) that REVERTS the real program if it
 *   fails (mirrored here as a SELF-DROP, never attempted).
 *
 * CAPS: `feeRate`/`maxGamma`/`maxNotionalSwap` are source-verified
 * (swap_math.rs's requires). `capBal`/`minSwapAmount` are WooPool fields
 * this deployment carries that the audited source (an older version) does
 * not define at all — the deployed WooPool account is 284 bytes vs the
 * audited 268, exactly a 16-byte insertion at this pair's offsets, empirically
 * confirmed byte-for-byte against 6 live pool dumps. Their exact enforcement
 * is UNDOCUMENTED upstream; modeled here CONSERVATIVELY (never a looser
 * bound than the real one could plausibly be) — see ladder.ts's capacity
 * derivation for the exact one-sided-safe reasoning (mirrors obric-v2's own
 * documented fee-rebate omission: predicted <= realized, never the reverse).
 * `minSwapAmount` is 0 on every live pool today (inert; still honored).
 * The "reserve" ledger field (WooPool's internal accounting mirror of the
 * vault) is NOT decoded — its deployed offset is unverified past the
 * documented fields — so capacity is bounded by the VAULT's real SPL balance
 * alone (one-sided safe: the true require is `reserve>=amt && vault>=amt`;
 * `vault>=amt` is necessary but not sufficient in a hypothetical
 * reserve-desyncs-below-vault state, an abnormal condition for the venue).
 *
 * Byte offsets (all little-endian; PriceUpdateV2's `verification_level` is
 * ALWAYS the 1-byte `Full` tag on any account the swap could accept — `Full`
 * is the second, no-payload enum variant, and `get_price_no_older_than`
 * hard-requires it, so `Partial`'s extra payload byte never appears on a
 * usable feed):
 *   WooAmmPool (617): wooracleA@73 woopoolA@105 tokenMintA@201 tokenVaultA@233
 *     wooracleB@265 woopoolB@297 tokenMintB@393 tokenVaultB@425 quoteTokenMint@457
 *   Wooracle (363): wooconfig@8 authority@40 tokenMint@72 feedAccount@104
 *     priceUpdate@136 maximumAge@168(u64) priceDecimals@176(u8) quoteDecimals@177(u8)
 *     baseDecimals@178(u8, UNUSED — WooPool's own base_decimals is what the
 *     program actually uses) updatedAt@179(i64) staleDuration@187(i64) bound@195(u64)
 *     price@203(u128) coeff@219(u64) spread@227(u64) rangeMin@235(u128) rangeMax@251(u128)
 *     quoteTokenMint@267 quoteFeedAccount@299 quotePriceUpdate@331
 *   WooPool (284, this deployment): feeRate@105(u16) maxGamma@107(u128)
 *     maxNotionalSwap@123(u128) capBal@139(u128) minSwapAmount@155(u128)
 *     tokenMint@187 tokenVault@219 baseDecimals@283(u8)
 *   PriceUpdateV2 (134): writeAuthority@8 verificationTag@40(u8) feedId@41
 *     price@73(i64) conf@81(u64,unused) exponent@89(i32,unused live — baked)
 *     publishTime@93(i64) prevPublishTime/emaPrice/emaConf/postedSlot (unused)
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
  */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'woofi';

export const WOOFI_PROGRAM_ID = address('WooFif76YGRNjk1pA8wCsN67aQsD9f9iLsz4NcJ1AVb');
// Module-private (every other venue keeps its own copy of this constant
// unexported too — see the barrel's `export *`, which would otherwise collide).
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Anchor `sha256("global:swap")[0..8]` — program-independent (same bytes obric-v2/meteora use for their own "swap" ix). */
export const WOOFI_SWAP_DISCRIMINATOR = [248, 198, 158, 145, 225, 117, 135, 200];

export const WOOFI_AMM_POOL_SIZE = 617;
export const WOOFI_WOOPOOL_SIZE = 284;
export const WOOFI_WOORACLE_SIZE = 363;
export const WOOFI_PRICE_UPDATE_SIZE = 134;

// WooAmmPool (discovery-only bundle) offsets.
export const OFF_AMM_WOORACLE_A = 73;
export const OFF_AMM_WOOPOOL_A = 105;
export const OFF_AMM_TOKEN_MINT_A = 201;
export const OFF_AMM_TOKEN_VAULT_A = 233;
export const OFF_AMM_WOORACLE_B = 265;
export const OFF_AMM_WOOPOOL_B = 297;
export const OFF_AMM_TOKEN_MINT_B = 393;
export const OFF_AMM_TOKEN_VAULT_B = 425;
export const OFF_AMM_QUOTE_TOKEN_MINT = 457;

// Wooracle offsets.
export const OFF_ORACLE_WOOCONFIG = 8;
export const OFF_ORACLE_PRICE_UPDATE = 136;
export const OFF_ORACLE_MAXIMUM_AGE = 168;
export const OFF_ORACLE_PRICE_DECIMALS = 176;
export const OFF_ORACLE_QUOTE_DECIMALS = 177;
export const OFF_ORACLE_UPDATED_AT = 179;
export const OFF_ORACLE_STALE_DURATION = 187;
export const OFF_ORACLE_BOUND = 195;
export const OFF_ORACLE_PRICE = 203;
export const OFF_ORACLE_COEFF = 219;
export const OFF_ORACLE_SPREAD = 227;
export const OFF_ORACLE_RANGE_MIN = 235;
export const OFF_ORACLE_RANGE_MAX = 251;
export const OFF_ORACLE_QUOTE_PRICE_UPDATE = 331;

// WooPool offsets (this deployment; 16 bytes ahead of the older audited source).
export const OFF_POOL_FEE_RATE = 105;
export const OFF_POOL_MAX_GAMMA = 107;
export const OFF_POOL_MAX_NOTIONAL_SWAP = 123;
export const OFF_POOL_CAP_BAL = 139;
/** u16, NOT u128 — bisection-verified against the real binary (see OFF_POOL_RESERVE's doc): a
 * wider read here would swallow OFF_POOL_RESERVE's low bytes. Always 0 on every live pool today. */
export const OFF_POOL_MIN_SWAP_AMOUNT = 155;
/**
 * A LIVE (not baked) per-pool accounting value the real `Swap` ix's newer,
 * deployed-only require (`ReserveLessThanFee`, not present in the audited
 * source this adapter otherwise mirrors) checks on the FROM side's own pool
 * before it will move anything. Bisection-verified against the real binary
 * (not documented anywhere): flipping only this field's low byte on a real
 * mainnet dump (woopoolBase, this pool's actual live bytes) took the swap
 * from a hard revert to succeeding. Semantics beyond "a floor this pool's own
 * activity must clear" are NOT independently confirmed (its exact relation
 * to swap_fee/from_amount, and its true width past 8 bytes, are unverified)
 * — modeled here as a conservative DIRECT cap on the tradable amount
 * (ladder.ts), the same one-sided-safe treatment as capBal. It reads 0 on
 * every live pool sampled 2026-07-31 (this pool's own real recent swaps all
 * fail on mainnet too — consistent with a currently-zeroed floor).
 */
export const OFF_POOL_RESERVE = 157;
export const OFF_POOL_TOKEN_MINT = 187;
export const OFF_POOL_TOKEN_VAULT = 219;
export const OFF_POOL_BASE_DECIMALS = 283;

// PriceUpdateV2 (Pyth receiver) offsets — see file header for the Full/1-byte-tag proof.
export const OFF_PYTH_VERIFICATION_TAG = 40;
export const OFF_PYTH_PRICE = 73;
export const OFF_PYTH_EXPONENT = 89;
export const OFF_PYTH_PUBLISH_TIME = 93;
export const PYTH_VERIFICATION_FULL = 1;

// SPL token account amount + mint decimals offsets (standard).
const TOKEN_ACCOUNT_AMOUNT_OFF = 64;
const MINT_DECIMALS_OFF = 44;

export const ONE_E18 = 1_000_000_000_000_000_000n;
export const ONE_E5 = 100_000n;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface WoofiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'sellBase' (default) sells the non-quote side for quote; 'sellQuote' is the reverse. */
  direction: 'sellBase' | 'sellQuote';
  wooconfig: Address;
  wooracleBase: Address;
  woopoolBase: Address;
  tokenMintBase: Address;
  tokenVaultBase: Address;
  priceUpdateBase: Address;
  wooracleQuote: Address;
  woopoolQuote: Address;
  quoteTokenMint: Address;
  quoteTokenVault: Address;
  priceUpdateQuote: Address;
  tokenProgram: Address;
  /** 10 ** wooracleBase.price_decimals. */
  priceDec: bigint;
  /** 10 ** wooracleBase.quote_decimals (the WooFi-internal quote decimals, e.g. 1e6). */
  quoteDec: bigint;
  /** 10 ** woopoolBase.base_decimals. */
  baseDec: bigint;
  /** wooracleBase.coeff (WAD) — baked (admin-set; the swap never mutates it). */
  coeff: bigint;
  /** woopoolBase.fee_rate (1e5-scaled) — the fee_rate BOTH single-leg directions charge. */
  feeRate: bigint;
  maxGamma: bigint;
  maxNotionalSwap: bigint;
  /** woopoolBase.cap_bal — undocumented upstream; modeled as a base-token-unit cap (see file header). */
  capBal: bigint;
  /** woopoolBase.min_swap_amount — 0 on every live pool today. */
  minSwapAmount: bigint;
  bound: bigint;
  staleDuration: bigint;
  rangeMin: bigint;
  rangeMax: bigint;
  maximumAge: bigint;
  /** 10 ** abs(quote Pyth feed's exponent) — baked (static feed metadata). */
  pythQuoteDecPow: bigint;
}

function woofiConfig(cfg: PoolConfig): WoofiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`woofi adapter got a config for venue '${cfg.venue}'`);
  return cfg as WoofiPoolConfig;
}

// The swap CPI moves tokens through the classic Tokenkeg program, so a
// Token-2022 mint (or one carrying an un-routable extension) must SELF-DROP.
// Detect the real token program per mint via the shared data-shape resolver;
// the thrown error IS the graceful drop (SvmRoute catches a fetchPoolConfig
// throw and drops the venue). LEGACY path byte-identical: a classic 82-byte
// mint classifies Tokenkeg, parses no extensions, config built unchanged. An
// unreadable mint falls back to the legacy assumption (keeps existing tests green).
async function gateMint(load: AccountLoader, mint: Address, pool: Address): Promise<void> {
  const data = await load(mint);
  if (data === null) return;
  if (classifyMintProgram(mint, data) === TOKEN_2022_PROGRAM_ID) {
    throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
  }
  const { blocking } = parseMintExtensions(data);
  if (blocking.length > 0) {
    throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
  }
}

/** Decode + gate one WooAmmPool bundle account (discovery convenience — never itself CPI'd). */
async function decodeAmmPool(
  load: AccountLoader,
  pool: Address,
): Promise<{
  wooracleA: Address; woopoolA: Address; tokenMintA: Address; tokenVaultA: Address;
  wooracleB: Address; woopoolB: Address; tokenMintB: Address; tokenVaultB: Address;
  quoteTokenMint: Address;
}> {
  const data = await load(pool);
  if (data === null) throw new Error(`woofi pool ${pool} account not found`);
  if (data.length !== WOOFI_AMM_POOL_SIZE) {
    throw new Error(`woofi pool ${pool} is ${data.length} bytes, expected ${WOOFI_AMM_POOL_SIZE}`);
  }
  return {
    wooracleA: pubkeyAt(data, OFF_AMM_WOORACLE_A),
    woopoolA: pubkeyAt(data, OFF_AMM_WOOPOOL_A),
    tokenMintA: pubkeyAt(data, OFF_AMM_TOKEN_MINT_A),
    tokenVaultA: pubkeyAt(data, OFF_AMM_TOKEN_VAULT_A),
    wooracleB: pubkeyAt(data, OFF_AMM_WOORACLE_B),
    woopoolB: pubkeyAt(data, OFF_AMM_WOOPOOL_B),
    tokenMintB: pubkeyAt(data, OFF_AMM_TOKEN_MINT_B),
    tokenVaultB: pubkeyAt(data, OFF_AMM_TOKEN_VAULT_B),
    quoteTokenMint: pubkeyAt(data, OFF_AMM_QUOTE_TOKEN_MINT),
  };
}

/**
 * Fetch + gate one WooFi pool. QUOTE-PAIRED ONLY (see file header): exactly
 * one of the bundle's two sides must equal `quoteTokenMint`, else this is a
 * genuine base-to-base pair and this adapter throws (not yet wired — a
 * follow-up, not a permission gate).
 */
export async function fetchWoofiConfig(load: AccountLoader, pool: Address): Promise<WoofiPoolConfig> {
  const bundle = await decodeAmmPool(load, pool);
  const aIsQuote = bundle.tokenMintA === bundle.quoteTokenMint;
  const bIsQuote = bundle.tokenMintB === bundle.quoteTokenMint;
  if (aIsQuote === bIsQuote) {
    throw new Error(
      `woofi pool ${pool} is a base-to-base pair (neither/both sides equal quoteTokenMint ${bundle.quoteTokenMint}) — not yet wired, see index.ts's SCOPE note`,
    );
  }

  const base = aIsQuote
    ? { wooracle: bundle.wooracleB, woopool: bundle.woopoolB, tokenMint: bundle.tokenMintB, tokenVault: bundle.tokenVaultB }
    : { wooracle: bundle.wooracleA, woopool: bundle.woopoolA, tokenMint: bundle.tokenMintA, tokenVault: bundle.tokenVaultA };
  const quote = aIsQuote
    ? { wooracle: bundle.wooracleA, woopool: bundle.woopoolA, tokenVault: bundle.tokenVaultA }
    : { wooracle: bundle.wooracleB, woopool: bundle.woopoolB, tokenVault: bundle.tokenVaultB };

  await Promise.all([
    gateMint(load, base.tokenMint, pool),
    gateMint(load, bundle.quoteTokenMint, pool),
  ]);

  const [oracleData, poolData] = await Promise.all([load(base.wooracle), load(base.woopool)]);
  if (oracleData === null) throw new Error(`woofi pool ${pool} base wooracle ${base.wooracle} not found`);
  if (oracleData.length !== WOOFI_WOORACLE_SIZE) {
    throw new Error(`woofi pool ${pool} base wooracle ${base.wooracle} is ${oracleData.length} bytes, expected ${WOOFI_WOORACLE_SIZE}`);
  }
  if (poolData === null) throw new Error(`woofi pool ${pool} base woopool ${base.woopool} not found`);
  if (poolData.length !== WOOFI_WOOPOOL_SIZE) {
    throw new Error(`woofi pool ${pool} base woopool ${base.woopool} is ${poolData.length} bytes, expected ${WOOFI_WOOPOOL_SIZE}`);
  }

  const wooconfig = pubkeyAt(oracleData, OFF_ORACLE_WOOCONFIG);
  const priceUpdateBase = pubkeyAt(oracleData, OFF_ORACLE_PRICE_UPDATE);
  const priceUpdateQuote = pubkeyAt(oracleData, OFF_ORACLE_QUOTE_PRICE_UPDATE);
  const priceDecimals = oracleData[OFF_ORACLE_PRICE_DECIMALS];
  const quoteDecimals = oracleData[OFF_ORACLE_QUOTE_DECIMALS];
  const maximumAge = readUintLE(oracleData, OFF_ORACLE_MAXIMUM_AGE, 8);
  const bound = readUintLE(oracleData, OFF_ORACLE_BOUND, 8);
  const staleDuration = readUintLE(oracleData, OFF_ORACLE_STALE_DURATION, 8);
  const rangeMin = readUintLE(oracleData, OFF_ORACLE_RANGE_MIN, 16);
  const rangeMax = readUintLE(oracleData, OFF_ORACLE_RANGE_MAX, 16);
  const coeff = readUintLE(oracleData, OFF_ORACLE_COEFF, 8);

  const feeRate = readUintLE(poolData, OFF_POOL_FEE_RATE, 2);
  const maxGamma = readUintLE(poolData, OFF_POOL_MAX_GAMMA, 16);
  const maxNotionalSwap = readUintLE(poolData, OFF_POOL_MAX_NOTIONAL_SWAP, 16);
  const capBal = readUintLE(poolData, OFF_POOL_CAP_BAL, 16);
  const minSwapAmount = readUintLE(poolData, OFF_POOL_MIN_SWAP_AMOUNT, 2);
  const baseDecimals = poolData[OFF_POOL_BASE_DECIMALS];

  const quotePythData = await load(priceUpdateQuote);
  if (quotePythData === null) throw new Error(`woofi pool ${pool} quote price-update ${priceUpdateQuote} not found`);
  if (quotePythData.length !== WOOFI_PRICE_UPDATE_SIZE) {
    throw new Error(`woofi pool ${pool} quote price-update ${priceUpdateQuote} is ${quotePythData.length} bytes, expected ${WOOFI_PRICE_UPDATE_SIZE}`);
  }
  const quoteExpoRaw = readUintLE(quotePythData, OFF_PYTH_EXPONENT, 4);
  const quoteExpo = quoteExpoRaw >= 1n << 31n ? Number(quoteExpoRaw - (1n << 32n)) : Number(quoteExpoRaw);
  const pythQuoteDecPow = 10n ** BigInt(Math.abs(quoteExpo));

  return {
    venue: SLUG,
    pool,
    direction: 'sellBase',
    wooconfig,
    wooracleBase: base.wooracle,
    woopoolBase: base.woopool,
    tokenMintBase: base.tokenMint,
    tokenVaultBase: base.tokenVault,
    priceUpdateBase,
    wooracleQuote: quote.wooracle,
    woopoolQuote: quote.woopool,
    quoteTokenMint: bundle.quoteTokenMint,
    quoteTokenVault: quote.tokenVault,
    priceUpdateQuote,
    tokenProgram: TOKEN_PROGRAM,
    priceDec: 10n ** BigInt(priceDecimals),
    quoteDec: 10n ** BigInt(quoteDecimals),
    baseDec: 10n ** BigInt(baseDecimals),
    coeff,
    feeRate,
    maxGamma,
    maxNotionalSwap,
    capBal,
    minSwapAmount,
    bound,
    staleDuration,
    rangeMin,
    rangeMax,
    maximumAge,
    pythQuoteDecPow,
  };
}

/** The 17-account order `Swap` expects (swap.rs, verified against 6 real mainnet transactions). */
export function woofiSwapAccounts(
  c: WoofiPoolConfig,
  user: SwapUser,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const sellBase = c.direction === 'sellBase';
  const r = refFor ?? ((role: string): string => role);
  // "from"/"to" per the real Anchor account order; sellBase: from=base,to=quote; sellQuote: reversed.
  const fromWooracle = sellBase ? c.wooracleBase : c.wooracleQuote;
  const fromWoopool = sellBase ? c.woopoolBase : c.woopoolQuote;
  const fromUserAta = user.inAta;
  const fromVault = sellBase ? c.tokenVaultBase : c.quoteTokenVault;
  const fromPriceUpdate = sellBase ? c.priceUpdateBase : c.priceUpdateQuote;
  const toWooracle = sellBase ? c.wooracleQuote : c.wooracleBase;
  const toWoopool = sellBase ? c.woopoolQuote : c.woopoolBase;
  const toUserAta = user.outAta;
  const toVault = sellBase ? c.quoteTokenVault : c.tokenVaultBase;
  const toPriceUpdate = sellBase ? c.priceUpdateQuote : c.priceUpdateBase;
  return [
    make(r('wooconfig'), c.wooconfig),
    make(r('tokprog'), c.tokenProgram),
    { ref: user.owner, signer: true },
    make(r('wof'), fromWooracle, true),
    make(r('wpf'), fromWoopool, true),
    { ref: fromUserAta, writable: true },
    make(r('vf'), fromVault, true),
    make(r('puf'), fromPriceUpdate, true),
    make(r('wot'), toWooracle, true),
    make(r('wpt'), toWoopool, true),
    { ref: toUserAta, writable: true },
    make(r('vt'), toVault, true),
    make(r('put'), toPriceUpdate, true),
    make(r('wpq'), c.woopoolQuote, true),
    make(r('puq'), c.priceUpdateQuote),
    make(r('vq'), c.quoteTokenVault, true),
    // rebate_to: UncheckedAccount, zero constraints — the payer's own wallet
    // is always a valid (if unused) target; avoids attaching a 17th foreign ref.
    { ref: user.owner },
  ];
}

const fixed = (r: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref: r, address: addr, writable: true } : { ref: r, address: addr };

export const woofi = {
  slug: SLUG,
  programId: WOOFI_PROGRAM_ID,
  fetchPoolConfig: fetchWoofiConfig,

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = woofiConfig(cfg);
    return [
      { ref: c.wooconfig, address: c.wooconfig },
      { ref: c.wooracleBase, address: c.wooracleBase },
      { ref: c.woopoolBase, address: c.woopoolBase },
      { ref: c.priceUpdateBase, address: c.priceUpdateBase },
      { ref: c.priceUpdateQuote, address: c.priceUpdateQuote },
      { ref: c.quoteTokenVault, address: c.quoteTokenVault },
      { ref: c.tokenVaultBase, address: c.tokenVaultBase },
    ];
  },

  /** v1 swap CPI (amount baked). */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = woofiConfig(cfg);
    const U128_MAX = (1n << 128n) - 1n;
    if (amountIn <= 0n || amountIn > U128_MAX) throw new Error(`woofi buildSwap amountIn must be a positive u128, got ${amountIn}`);
    const data = new Uint8Array(8 + 16 + 16);
    data.set(WOOFI_SWAP_DISCRIMINATOR, 0);
    for (let b = 0; b < 16; b++) data[8 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[24] = 1; // min_to_amount = 1 (the recipe's terminal delta owns the bound)
    return { programId: WOOFI_PROGRAM_ID, data, accounts: woofiSwapAccounts(c, user, fixed) };
  },
};
