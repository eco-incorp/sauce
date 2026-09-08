/**
 * Moonit (program `MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG`) — the moon.it
 * (formerly Moonshot) Solana token-launchpad bonding curve. Anchor IDL pulled
 * verbatim from `tenequm/solana-idls`'s `idl/moonshot.json` (address matches
 * this program exactly) and cross-checked byte-for-byte against the program's
 * OWN current `tokenLaunchpadIdlV4.ts` (bundled in the `@moonit/sdk`/
 * `gomoonit/moonit-sdk` npm-published TS SDK, whose declared instruction
 * discriminators/account layouts are used here directly — no hashing needed).
 *
 * CURVE ACCOUNT (`CurveAccount`, disc `sha256("account:CurveAccount")[:8]` =
 * `[8,91,83,28,132,216,248,22]`, a FIXED 84-byte prefix — real on-chain
 * accounts run to 409 bytes, the tail is zeroed reserved padding for future
 * fields, confirmed live against 220,103 sampled accounts):
 *   total_supply        u64    @8     curve_amount         u64    @16
 *   mint                 pubkey @24    decimals             u8     @56
 *   collateral_currency  u8(enum,1 variant: Sol) @57
 *   curve_type           u8(enum: 0=LinearV1,1=ConstantProductV1,
 *                        2=ConstantProductV2,3=FlatCurveV1,4=FlatCurveV1AntiSnipe) @58
 *   marketcap_threshold  u64    @59    marketcap_currency   u8     @67
 *   migration_fee        u64    @68    coef_b               u32    @76
 *   bump                 u8     @80    migration_target     u8     @81
 *   price_increase       u16    @82
 * Live gPA sweep (2026-07-31, memcmp disc + dataSize 409): 220,103 curves —
 * curve_type distribution 0(LinearV1)=73,096, 1(ConstantProductV1)=146,257,
 * 3(FlatCurveV1)=656, 4(FlatCurveV1AntiSnipe)=94, 2(ConstantProductV2)=0
 * observed. ONLY curve_type 0 (LinearV1) is implemented here — the maintainer
 * brief's own "coefB" framing matches LinearV1's single stored coefficient
 * exactly; every other curve_type SELF-DROPS at fetch time (a named gate
 * error), never a crash or a silent mis-quote.
 *
 * CONFIG ACCOUNT (singleton, PDA `["config_account"]`, disc
 * `[189,255,97,70,186,189,24,102]`, verified live at
 * `36Eru7v11oU5Pfrojyn5oY3nETA1a1iqsw2WUu6afkM9`; the live account runs to 403
 * bytes, only the fixed prefix below is read):
 *   ...(5 pubkeys)...   fee_bps u16 @168   dex_fee_share u8 @170   ...
 * `fee_bps`/`dex_fee`/`helio_fee` are read LIVE at fetch time (mutable via
 * `configUpdate`); `dex_fee_share` only decides how the SAME total fee splits
 * between the two fee-recipient accounts — it never changes the trade's
 * economics and is not read.
 *
 * CLOSED-FORM MATH (LinearV1 — ported from the program's own published
 * `@heliofi/launchpad-common` npm package, `LinearCurveV1`/`BaseCurve`, the
 * exact library `@moonit/sdk`'s `LinearCurveV1Adapter` calls): a linear
 * per-token price `price(s) = coefA*s + coefB` (s = tokens already sold,
 * `curve_amount`/`total_supply` give `s = total_supply - curve_amount`), so
 * the cost to trade `n` tokens starting at position `s0` is the trapezoid
 * `n*(coefA*(2*s0+n)/2 + coefB)`. `coefB` is the ONLY stored coefficient;
 * `coefA` is DERIVED, every time, from `coefB` + `total_supply` +
 * `marketcap_threshold` (all static CurveAccount fields) via a hardcoded 55%
 * "dynamic threshold" constant baked into the SDK's own `LinearCurveV1` class
 * (`this.dynamicThreshold = 55`):
 *   X55 = total_supply * 0.55
 *   coefA = (marketcap_threshold/X55 - coefB) / X55
 * `AwFixed`/`BwFixed` below are `coefA`/`coefB` pre-baked as EXACT fixed-point
 * integers (computed once, off-chain, with full bigint precision — no
 * on-chain derivation of coefA is attempted) at SCALE_A=1e30 / SCALE_B=1e18;
 * `coefA` can be astronomically small (~1e-10 to ~1e-18 across the config's
 * supported total-supply range), so `AwFixed` may exceed a u64 and rides as a
 * (hi,lo) u64 pair reconstructed on-chain via `(hi << 64) | lo` — the EXACT
 * technique `obric-v2`'s `bigK` already uses for its own 128-bit constant.
 *
 * FEE MODEL — measured LIVE via 6 real `simulateTransaction` calls against
 * the ACTUAL deployed program (sigVerify:false, a real trading wallet
 * `HmaikVLfaNrgE3ooVEja7qs7tRWbkmynnWwzT9DiGUEo` that already held both SOL
 * and the traded mint — no impersonation of an unrelated whale needed), on
 * REAL mainnet curve `GnM6fY3hDnt6fUBrRK89xZQ5cdayvHnz6TWrnYan9Es6` (mint
 * `8FCTHXhJmkhtYSvapLh4ACCzQEdHf1ab97Mavzac3Y3y`, coef_b=10,
 * marketcap_threshold=500 SOL, fee_bps=100 at simulation time): the program's
 * own log line ("Transfering collateral ... : X, Helio fee: Y, Dex fee: Z")
 * and its `TradeEvent` self-CPI log agree exactly, and pin the fee order:
 *   BUY  (fixed_side=IN, collateral_amount EXACT): fee = floor(collateral_in
 *        * fee_bps/10000); the CURVE receives collateral_in - fee (fee is
 *        taken OFF THE INPUT before the curve math runs).
 *   SELL (fixed_side=IN, token_amount EXACT): gross = curve(token_amount);
 *        fee = floor(gross*fee_bps/10000); user receives gross - fee (fee is
 *        taken OFF THE OUTPUT after the curve math runs).
 * Golden values (three sizes each direction, `test/svm/venues/moonit.test.ts`
 * pins these): BUY 300,000/700,000/1,500,000 lamports in ->
 * 19,719,929,410,422 / 45,947,767,273,069 / 98,181,578,724,015 tokens out
 * (curve position 3,086,043,000,000,000 throughout — each simulate call is
 * independent, same starting state); SELL 50,000,000,000,000 /
 * 150,000,000,000,000 / 400,000,000,000,000 tokens in -> exactly 742,694 /
 * 2,215,944 / 5,828,267 lamports out (bit-exact against `referenceQuote`
 * below — the SELL closed form has no sqrt, so it is exact; BUY's isqrt
 * introduces a residual of at most ~1 part in 2×10^8 of the real value,
 * negligible next to the venue's own slippage tolerance).
 *
 * TRADE ARGS — `TradeParams{token_amount, collateral_amount, fixed_side:u8
 * (IN=0/OUT=1), slippage_bps}`: this module ALWAYS uses `fixed_side=IN` (the
 * side matching the the consuming app ladder's own exact-input contract) and floors the
 * OTHER (estimated) side at 1 with `slippage_bps=0` — the recipe's own
 * terminal outAta delta / minOut check is the real floor, mirroring every
 * other wired venue's "venue-level min_out is always 1" convention.
 *
 * NATIVE-SOL COLLATERAL, NOT WSOL — a FIRST for this ladder set: `buy`/`sell`
 * move collateral as NATIVE LAMPORTS directly on the `sender` account (no
 * WSOL mint/ATA anywhere in the instruction's 11 accounts — confirmed by the
 * simulateTransaction validation above succeeding with no wSOL account
 * supplied at all), unlike every other wired venue's WSOL-SPL "quote" leg.
 * `sender` here is `user.owner` (already writable+signer on every ladder for
 * exactly this kind of native-authority need — `pumpfun-bonding-curve.ts`
 * sets the identical `{ writable: true, signer: true }` flag on `user.owner`
 * for its own fee-PDA derivation). A trade that puts Moonit's slot inside an
 * overall SOL-denominated trade therefore needs `user.owner`'s NATIVE lamport
 * balance to already reflect the SOL leg (no automatic wrap/unwrap around
 * this one slot) — a disclosed narrowing of the general WSOL-uniform model
 * every other venue assumes, not a silent one; Moonit's own instruction set
 * has no `_v2`/arbitrary-quote-mint alternative to dodge it (unlike
 * pump.fun's classic curve, which does).
 *
 * Real-CPI (LiteSVM `execute_from_account`) coverage needs a sauce engine.so
 * this environment has no access to build against (same gap
 * `pumpfun-bonding-curve` disclosed) — `test/fast/svm-realcpi-coverage.test.ts`
 * names it in KNOWN_GAPS pending an available build.
 */
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "moonit" as const;

export const MOONIT_PROGRAM_ID = address_("MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG");
const TOKEN_PROGRAM = address_("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address_("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** PDA(["config_account"], MOONIT_PROGRAM_ID) — a singleton, verified live 2026-07-31. */
const CONFIG_ACCOUNT = address_("36Eru7v11oU5Pfrojyn5oY3nETA1a1iqsw2WUu6afkM9");

const CURVE_DISCRIMINATOR = [8, 91, 83, 28, 132, 216, 248, 22];
const CONFIG_DISCRIMINATOR = [189, 255, 97, 70, 186, 189, 24, 102];
const CURVE_TYPE_LINEAR_V1 = 0;
const CURRENCY_SOL = 0;
/** coefA fixed-point scale — see the module header. Split hi/lo (see below) since coefA*SCALE_A can exceed u64. */
const SCALE_A = 10n ** 30n;
/** coefB fixed-point scale — coefB is a u32, so coefB*SCALE_B/1e9 always fits u64 (max ~4.29e18). */
const SCALE_B = 10n ** 18n;
const MASK64 = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

function address_(s: string): Address {
  return s as unknown as Address;
}
function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}
function pubkeyAt(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
async function loadAccount(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`moonit ${what} ${addr} not found`);
  return data;
}
async function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const seeds = [owner, tokenProgram, mint].map((a) => new Uint8Array(encoder.encode(a)));
  const [derived] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds,
  });
  return derived;
}
/** floor(a*b/c), non-negative — the TS mirror of the emitted Math.mulDiv. */
function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b) / c;
}
/** round-half-up of a non-negative num/den — used only when BAKING the fixed-point constants. */
function roundRatio(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}
/** Floor integer square root (mirrors the engine's SQRT op — same algorithm as obric-v2's isqrt). */
function isqrt(value: bigint): bigint {
  if (value < 0n) throw new Error(`isqrt needs a non-negative value, got ${value}`);
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

export interface MoonitPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** exactIn side: 'quoteToBase' (default, buy: SOL in, tokens out) | 'baseToQuote' (sell). */
  direction: "quoteToBase" | "baseToQuote";
  mint: Address;
  curveTokenAccount: Address;
  dexFee: Address;
  helioFee: Address;
  /** coefA baked as (hi,lo) u64 halves at SCALE_A — see the module header. */
  awHi: bigint;
  awLo: bigint;
  /** coefB baked at SCALE_B (always fits a single u64). */
  bwFixed: bigint;
  /** 10^decimals. */
  tdScale: bigint;
  feeBps: bigint;
}

/** Derive coefA/coefB's fixed-point bakes from the CurveAccount's static fields (exact bigint, no rounding until the single final step). */
function bakeCoefficients(
  totalSupplyRaw: bigint,
  coefBRaw: bigint,
  marketcapThresholdRaw: bigint,
  decimals: bigint,
): { awHi: bigint; awLo: bigint; bwFixed: bigint; tdScale: bigint } {
  const tdScale = 10n ** decimals;
  const cdScale = 1_000_000_000n; // Sol, the only supported collateral currency
  const mcdScale = 1_000_000_000n; // Sol, the only supported marketcap currency
  // X55 = total_supply_whole * 0.55 = totalSupplyRaw*11/(20*tdScale)
  const x55n = 11n * totalSupplyRaw;
  const x55d = 20n * tdScale;
  // coefA = (Mt - coefB*X55) / X55^2, Mt = marketcapThresholdRaw/mcdScale, coefB = coefBRaw/cdScale
  const awNum = marketcapThresholdRaw * cdScale * x55d - coefBRaw * x55n * mcdScale;
  const awNumFull = awNum * x55d;
  const awDenFull = mcdScale * cdScale * x55n * x55n;
  if (awNumFull <= 0n) {
    throw new Error(
      `moonit curve gate: derived coefA is non-positive (marketcap_threshold too low for coefB/total_supply) — degenerate curve`,
    );
  }
  const awFixed = roundRatio(awNumFull * SCALE_A, awDenFull);
  if (awFixed > U128_MAX) {
    throw new Error(
      `moonit curve gate: coefA fixed-point bake overflows 128 bits (extreme total_supply/marketcap_threshold combination)`,
    );
  }
  const bwFixed = roundRatio(coefBRaw * SCALE_B, cdScale);
  return { awHi: awFixed >> 64n, awLo: awFixed & MASK64, bwFixed, tdScale };
}

export const moonit = {
  slug: SLUG,
  programId: MOONIT_PROGRAM_ID,
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<MoonitPoolConfig> {
    const curveData = await loadAccount(load, pool, "curve account");
    if (!hasDiscriminator(curveData, CURVE_DISCRIMINATOR)) {
      throw new Error(`moonit pool ${pool} discriminator mismatch (not a CurveAccount)`);
    }
    if (curveData.length < 84) {
      throw new Error(
        `moonit pool ${pool} data is ${curveData.length} bytes, expected at least 84`,
      );
    }
    const totalSupply = readUintLE(curveData, 8, 8);
    const mint = pubkeyAt(curveData, 24);

    // Token-2022 safety: this venue's buy/sell ix is legacy-SPL (Tokenkeg) only,
    // so a Token-2022 mint (or one carrying an un-routable extension) SELF-DROPS
    // the pool via a thrown, clearly-described error — the SvmRoute orchestrator
    // catches a fetchPoolConfig throw and drops the venue. The legacy path stays
    // byte-identical: a classic 82-byte mint classifies as legacy → no throw, and
    // an unreadable mint (not vendored by a fixture) falls back to legacy.
    for (const swapMint of [mint]) {
      const swapMintData = await load(swapMint);
      if (swapMintData === null) continue;
      if (classifyMintProgram(swapMint, swapMintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${swapMint} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(swapMintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${swapMint} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }

    const decimals = BigInt(curveData[56]!);
    const collateralCurrency = curveData[57]!;
    const curveType = curveData[58]!;
    const marketcapThreshold = readUintLE(curveData, 59, 8);
    const marketcapCurrency = curveData[67]!;
    const coefBRaw = readUintLE(curveData, 76, 4);

    if (curveType !== CURVE_TYPE_LINEAR_V1) {
      throw new Error(
        `moonit pool ${pool} gate: curve_type ${curveType} is not LinearV1 (0) — only LinearV1 is implemented`,
      );
    }
    if (collateralCurrency !== CURRENCY_SOL || marketcapCurrency !== CURRENCY_SOL) {
      throw new Error(
        `moonit pool ${pool} gate: unsupported currency (collateral=${collateralCurrency}, marketcap=${marketcapCurrency}) — only Sol (0) is implemented`,
      );
    }

    const { awHi, awLo, bwFixed, tdScale } = bakeCoefficients(
      totalSupply,
      coefBRaw,
      marketcapThreshold,
      decimals,
    );

    const configData = await loadAccount(load, CONFIG_ACCOUNT, "config account");
    if (!hasDiscriminator(configData, CONFIG_DISCRIMINATOR)) {
      throw new Error(`moonit config account ${CONFIG_ACCOUNT} discriminator mismatch`);
    }
    const helioFee = pubkeyAt(configData, 104);
    const dexFee = pubkeyAt(configData, 136);
    const feeBps = readUintLE(configData, 168, 2);

    const curveTokenAccount = await ata(pool, mint, TOKEN_PROGRAM);

    return {
      venue: SLUG,
      pool,
      direction: "quoteToBase",
      mint,
      curveTokenAccount,
      dexFee,
      helioFee,
      awHi,
      awLo,
      bwFixed,
      tdScale,
      feeBps,
    };
  },
};

/** BUY: exact gross collateral `y` in (fee taken off the input) -> tokens out, capped at the curve's live inventory. */
function referenceBuy(
  y: bigint,
  m: bigint,
  aw: bigint,
  bw: bigint,
  td: bigint,
  feeBps: bigint,
  curveAmount: bigint,
): bigint {
  if (y === 0n) return 0n;
  const fee = mulDiv(y, feeBps, 10000n);
  const net = y - fee;
  if (net === 0n) return 0n;
  const bwScaled = mulDiv(SCALE_A, bw, SCALE_B); // coefB at scale SCALE_A
  const bp = 2n * (aw * m + bwScaled * td);
  const cScaled = mulDiv(SCALE_A, net, 1_000_000_000n);
  const cp = 2n * cScaled * td * td;
  const disc = bp * bp + 4n * aw * cp;
  const sq = isqrt(disc);
  const numerator = sq - bp;
  if (numerator <= 0n) return 0n;
  let out = numerator / 2n / aw;
  if (out > curveAmount) out = curveAmount;
  return out;
}

/** SELL: exact tokens `x` in (fee taken off the output) -> collateral out. Saturates at the live sold position (never over-sells). */
function referenceSell(
  x: bigint,
  m: bigint,
  aw: bigint,
  bw: bigint,
  td: bigint,
  feeBps: bigint,
): bigint {
  if (x === 0n) return 0n;
  const xx = x > m ? m : x;
  const twoMN = 2n * m - xx;
  const step1 = mulDiv(aw, twoMN, 2n);
  const step2 = mulDiv(step1, xx, td);
  const step3 = step2 / td;
  const term1 = mulDiv(step3, 1_000_000_000n, SCALE_A);
  const stepB = mulDiv(bw, xx, td);
  const term2 = mulDiv(stepB, 1_000_000_000n, SCALE_B);
  const gross = term1 + term2;
  const fee = mulDiv(gross, feeBps, 10000n);
  return gross - fee;
}

export {
  referenceBuy as _referenceBuyForTest,
  referenceSell as _referenceSellForTest,
  bakeCoefficients as _bakeCoefficientsForTest,
  isqrt as _isqrtForTest,
};
