/**
 * Jupiter Perpetuals (JLP pool) `swap2` venue adapter — a BASKET AMM, not a
 * per-pair pool: one global `Pool` account (name "Pool", well-known address)
 * holds N `Custody` accounts (one per supported mint — SOL/ETH/BTC/USDC/USDT
 * plus any later addition), and `swap2` exchanges any two custodies' tokens
 * at the Doves-oracle price, fee-adjusted by a target-weight tax/rebate.
 *
 * SHAPE MISMATCH WITH THE OTHER 13 FAMILIES (read this before touching
 * discovery wiring): every other family's `pool` account embeds BOTH mints,
 * so one address fully identifies a tradable pair. A JLP `Custody` embeds
 * only ONE mint — the tradable unit is an (custodyIn, custodyOut) PAIR
 * sharing one `Pool`. `fetchPoolConfig(load, custodyIn, mintOut)` self-
 * discovers mintIn by decoding `custodyIn` directly (never taken on faith
 * from a caller) and needs exactly ONE extra piece of information beyond
 * every other family's `(load, pool)` shape: `mintOut`, the ONLY thing no
 * single account embeds. The recipe threads it as a plain `direction` STRING
 * (mintOut's base58) — not a struct — through `entry.fetch`'s existing
 * `(load, pool, direction?)` field type (an additive widening: the other 13
 * families' 2-arg fetchers stay assignable, ignoring the extra argument) —
 * see the consuming app SVM solver entry's `directionForPair` hook and its perps-jlp
 * FAMILIES entry for how both call sites (fresh discovery AND the
 * pre-codegen re-fetch, which only ever has `spec.direction` in scope, never
 * the original pair) supply it identically.
 *
 * PDA DERIVATION (verified against real mainnet state 2026-07-31):
 *   custody   = findProgramAddress(["custody", pool, mint], PROGRAM_ID)
 *   perpetuals = findProgramAddress(["perpetuals"], PROGRAM_ID)
 *   transfer_authority = findProgramAddress(["transfer_authority"], PROGRAM_ID)
 *   __event_authority  = findProgramAddress(["__event_authority"], PROGRAM_ID)
 * (the Solana Labs `perpetuals` program template's canonical seeds — Jupiter
 * Perps is a fork of it). `custody` was independently re-derived from the
 * JLP pool address + the well-known SOL mint and matched the real SOL
 * custody address (7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz) byte-for-byte;
 * `__event_authority` matched the community-published constant
 * (37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN). Both `perpetuals` and
 * `transfer_authority` were independently fetched and confirmed owned by the
 * program (transfer_authority: 0-byte pure-signer PDA; perpetuals: 120-byte
 * config account, discriminator 1ca762bf68526cc4).
 *
 * FEE MODEL — swap2 uses ONLY the target-ratio tax/rebate fee
 * (`swapBps`/`taxBps` or the `stableSwap*` variants when BOTH custodies are
 * stable), never the position-only price-impact-buffer/tradeImpactFeeScalar
 * additive fee. This is the one genuinely contestable call in this adapter,
 * so it is triple-sourced rather than assumed:
 *   (1) official docs (developers.jup.ag/docs/perps/custody-account):
 *       tradeImpactFeeScalar "Sets the base value when calculating price
 *       impact fees when opening or closing POSITIONS" (positions, not swaps);
 *   (2) the on-chain program's OWN emitted events (the live IDL's `events`,
 *       decoded from the on-chain Anchor IDL account 2026-07-31): PoolSwapEvent
 *       carries a single blended `feeBps` field and no price-impact
 *       component, while IncreasePositionEvent carries BOTH `positionFeeUsd`
 *       AND a separate `priceImpactFeeUsd` — the program itself only
 *       computes/reports a price-impact fee for position trades;
 *   (3) the community-maintained swap-fee reference
 *       (github.com/julianfssen/jupiter-perps-anchor-idl-parsing,
 *       calculate-swap-amount-and-fee.ts) implements swap fees via
 *       `getSwapFeeBps`/`getFeeBps` (the target-ratio tax model) and never
 *       touches `priceImpactBuffer` or `tradeImpactFeeScalar`.
 * Implemented EXACTLY (not simplified): both custodies' theoretically-owned
 * balances (which fold in net internal-lending debt — material for USDC,
 * whose real `debt` was ~$112.76M against ~$133.32M owned on 2026-07-31),
 * the rebate-vs-tax branch, and the average-diff tax formula.
 *
 * externalSwapFeeMultiplierBps (a 2026 Custody field absent from the
 * community IDL snapshot and from the official docs page at the time of
 * writing — decoded here straight from the live on-chain Anchor IDL account):
 * observed nonzero (10000-20000, i.e. 1x-2x) on every NON-stable mainnet
 * custody and 0 on both stable custodies. Its exact on-chain semantics are
 * not documented publicly; this adapter is a genuine external CPI caller (an
 * on-chain program invoking swap2 directly, not Jupiter's own front end),
 * which is the plain-language reading the field's name suggests applies to.
 * Treated CONSERVATIVELY: baked as the LARGER of the two sides' stored
 * multipliers (0 defaults to 10_000 = 1x, never a discount), so an
 * unconfirmed guess can only make the predicted quote WORSE than reality,
 * never better — one-sided safe for minOut, matching obric-v2's documented
 * convention for its own fee-rebate simplification.
 *
 * BAKE THE SHAPE, READ THE STATE (the SAME split every other oracle-anchored
 * family in this directory uses): decimals, isStable, targetRatioBps, the
 * pool fee bps quadruple, the externalSwapFeeMultiplier and the Doves feed
 * exponent are governance/feed CONSTANTS (baked as cfg params); the fragment
 * reads LIVE on-chain: both custodies' assets.{owned,locked,guaranteedUsd}
 * (+ debt/borrowLendInterestsAccured for a STABLE side only — for a
 * non-stable side they algebraically cancel out of `owned − locked`, so the
 * fragment skips both reads and the ceil-division entirely), the Pool's
 * aumUsd, and both custodies' Doves price. Byte offsets verified against the
 * on-chain Anchor IDL (decoded 2026-07-31; PDA seeds pinned in ladder.ts) and
 * a real mainnet dump of the JLP pool + 6 custodies (SOL/ETH/BTC/USDC/USDT +
 * a 6th newer stable asset) — every custody's byte range past offset 1117 is
 * all-zero padding, confirming the field table below is the complete struct.
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
import {
  address,
  getAddressCodec,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";

const SLUG = "perps-jlp";

export const PERPS_JLP_PROGRAM_ID = address("PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** The single production JLP pool (name "Pool", 6 custodies as of 2026-07-31). */
export const JLP_POOL_ADDRESS = address("5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq");

/** sha256('account:Custody')[0..8]. */
const CUSTODY_DISCRIMINATOR = [0x01, 0xb8, 0x30, 0x51, 0x5d, 0x83, 0x3f, 0x91];
/** sha256('account:Pool')[0..8]. */
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
/** sha256('global:swap2')[0..8]. */
export const SWAP2_DISCRIMINATOR = [0x41, 0x4b, 0x3f, 0x4c, 0xeb, 0x5b, 0x5b, 0x88];

/** The full occupied Custody struct length (confirmed all-zero padding past this on 6 real mainnet custodies). */
export const CUSTODY_ACCOUNT_SIZE = 1117;

// Custody field offsets (from the disc-inclusive account start; IDL-verified,
// see the module doc). Fields not read at all (oracle.buffer/maxPriceAgeSec,
// pricing.*, permissions[1..6], fundingRateState, bump*, increase/decrease
// PositionBps, maxPositionSizeUsd, jumpRateState, borrowLendParameters,
// borrowsFundingRateState, most withdrawal-limit fields) are omitted.
const OFF_MINT = 40;
const OFF_TOKEN_ACCOUNT = 72;
const OFF_DECIMALS = 104;
const OFF_IS_STABLE = 105;
const OFF_ORACLE_ACCOUNT = 106; // Pythnet price account (attached to the CPI, unread for pricing — see ladder.ts doc)
const OFF_ALLOW_SWAP = 199; // Permissions.allowSwap (first of 7 bools)
const OFF_TARGET_RATIO_BPS = 206;
const OFF_DOVES_ORACLE = 320;
const OFF_EXTERNAL_SWAP_FEE_MULTIPLIER_BPS = 1076;

// Doves `priceFeed` account (program DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e):
// pair[32] @8, signer[33] @40, price u64 @73, expo i8 @81, timestamp i64 @82, bump u8 @90.
export const DOVES_PRICE_OFFSET = 73;
export const DOVES_EXPO_OFFSET = 81;
export const DOVES_TIMESTAMP_OFFSET = 82;
export const DOVES_FEED_SIZE = 91;

/**
 * A "the feed is dead, not just latent" sanity ceiling (seconds) — the
 * real on-chain custody enforces its OWN much tighter `oracle.maxPriceAgeSec`
 * (observed 5s on the real mainnet SOL/USDC custodies 2026-07-31) at swap2
 * execution time; that live, on-chain check is the authoritative freshness
 * backstop and reverts the whole cook for this slot if violated, exactly
 * like every other venue's runtime-failure self-drop. Trying to replicate a
 * 5s bound OFF-CHAIN at prepare time would self-drop this venue almost
 * unconditionally (any nonzero prepare-to-cook latency exceeds it) — a
 * "NO PREMATURE GATING" violation, not a safety measure. This constant only
 * catches a feed that has stopped updating entirely (an abandoned/broken
 * Doves keeper), not ordinary staleness.
 */
export const DOVES_MAX_AGE_SEC = 3_600n;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/**
 * Baked scale for `floor(c1 * c2 * 10^(e1+e2-te))` — the shared shape of
 * every `checkedDecimalMul(c1, e1, c2, e2, te)` call this venue's math uses
 * (both the exchange-rate conversion and every USD conversion). Because
 * decimals/exponents are all baked (governance/feed constants), the SIGN of
 * `targetPower` is known off-chain, so the fragment never needs a runtime
 * branch: exactly one of `scaleUp`/`scaleDown` is ever != 1, so
 * `floor(c1 * c2 * scaleUp / scaleDown)` reproduces the reference's two-way
 * branch with ONE unconditional expression.
 */
export function bakedDecimalScale(
  e1: number,
  e2: number,
  targetExponent: number,
): { scaleUp: bigint; scaleDown: bigint } {
  const targetPower = e1 + e2 - targetExponent;
  if (targetPower >= 0) return { scaleUp: 10n ** BigInt(targetPower), scaleDown: 1n };
  return { scaleUp: 1n, scaleDown: 10n ** BigInt(-targetPower) };
}

/** USD conversion is always scaled to -6 (USDC_DECIMALS), per the reference SDK's `getAssetAmountUsd`. */
const USD_TARGET_EXPONENT = -6;
/** `getSwapPrice`'s ORACLE_PRICE_SCALE / ORACLE_EXPONENT_SCALE constants. */
const ORACLE_PRICE_SCALE = 1_000_000_000n;
const ORACLE_EXPONENT_SCALE = -9;

export interface PerpsJlpPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  pool: Address; // JLP_POOL_ADDRESS
  mintIn: Address;
  mintOut: Address;
  custodyIn: Address;
  custodyOut: Address;
  tokenAccountIn: Address;
  tokenAccountOut: Address;
  dovesOracleIn: Address;
  dovesOracleOut: Address;
  pythAccountIn: Address; // CPI-required, unread for pricing
  pythAccountOut: Address;
  tokenProgram: Address;
  /** Program-wide constant PDAs, pre-derived at fetch time (buildSwapV2 is synchronous). */
  transferAuthority: Address;
  perpetuals: Address;
  eventAuthority: Address;
  decimalsIn: number;
  decimalsOut: number;
  /** Baked exchange-rate scale: amountOutBeforeFees = floor(amountIn * swapPriceCoeff * fxScaleUp / fxScaleDown). */
  fxScaleUp: bigint;
  fxScaleDown: bigint;
  /** Baked per-side USD-conversion scale (getAssetAmountUsd at this side's own decimals/expo). */
  usdScaleUpIn: bigint;
  usdScaleDownIn: bigint;
  usdScaleUpOut: bigint;
  usdScaleDownOut: bigint;
  isStableIn: boolean;
  isStableOut: boolean;
  targetRatioBpsIn: bigint;
  targetRatioBpsOut: bigint;
  /** The (baseFeeBps, taxFeeBps, multiplier) triple — stableSwap* iff BOTH custodies are stable. */
  baseFeeBps: bigint;
  taxFeeBps: bigint;
  multiplier: bigint;
  /** max(externalSwapFeeMultiplierBpsIn, externalSwapFeeMultiplierBpsOut, 10_000) — conservative bake, see module doc. */
  externalMultiplierBps: bigint;
  /** Dynamic byte offset of Pool.aumUsd (shifts if Jupiter ever adds/removes a custody or renames the pool). */
  poolAumUsdOffset: bigint;
  /** Dynamic byte offset of Pool.fees (== poolAumUsdOffset + 56, the Limit struct's fixed 40B + aumUsd's 16B). */
  poolFeesOffset: bigint;
}

function perpsJlpConfig(cfg: PoolConfig): PerpsJlpPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  return cfg as PerpsJlpPoolConfig;
}

const utf8 = getUtf8Encoder();
const addrEnc = getAddressEncoder();

/** `findProgramAddress(["custody", pool, mint], PERPS_JLP_PROGRAM_ID)` — verified against real SOL custody. */
export async function custodyPda(pool: Address, mint: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(PERPS_JLP_PROGRAM_ID, [
    utf8.encode("custody") as Uint8Array,
    addrEnc.encode(pool) as Uint8Array,
    addrEnc.encode(mint) as Uint8Array,
  ]);
}

let cachedTransferAuthority: Address | undefined;
let cachedPerpetuals: Address | undefined;
let cachedEventAuthority: Address | undefined;

/** `findProgramAddress(["transfer_authority"], PERPS_JLP_PROGRAM_ID)` — cached (program-wide constant). */
export async function transferAuthorityPda(): Promise<Address> {
  if (cachedTransferAuthority !== undefined) return cachedTransferAuthority;
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_JLP_PROGRAM_ID,
    seeds: [utf8.encode("transfer_authority")],
  });
  cachedTransferAuthority = pda;
  return pda;
}

/** `findProgramAddress(["perpetuals"], PERPS_JLP_PROGRAM_ID)` — cached (program-wide constant). */
export async function perpetualsPda(): Promise<Address> {
  if (cachedPerpetuals !== undefined) return cachedPerpetuals;
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_JLP_PROGRAM_ID,
    seeds: [utf8.encode("perpetuals")],
  });
  cachedPerpetuals = pda;
  return pda;
}

/** `findProgramAddress(["__event_authority"], PERPS_JLP_PROGRAM_ID)` — matches the published constant. */
export async function eventAuthorityPda(): Promise<Address> {
  if (cachedEventAuthority !== undefined) return cachedEventAuthority;
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_JLP_PROGRAM_ID,
    seeds: [utf8.encode("__event_authority")],
  });
  cachedEventAuthority = pda;
  return pda;
}

interface DecodedCustody {
  mint: Address;
  tokenAccount: Address;
  decimals: number;
  isStable: boolean;
  pythAccount: Address;
  allowSwap: boolean;
  targetRatioBps: bigint;
  dovesOracle: Address;
  externalSwapFeeMultiplierBps: bigint;
}

function decodeCustody(addr: Address, data: Uint8Array): DecodedCustody {
  if (data.length < CUSTODY_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} custody ${addr} is ${data.length} bytes, expected >= ${CUSTODY_ACCOUNT_SIZE}`,
    );
  }
  if (!CUSTODY_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error(`${SLUG} custody ${addr} is not a Custody account (discriminator mismatch)`);
  }
  return {
    mint: pubkeyAt(data, OFF_MINT),
    tokenAccount: pubkeyAt(data, OFF_TOKEN_ACCOUNT),
    decimals: data[OFF_DECIMALS],
    isStable: data[OFF_IS_STABLE] === 1,
    pythAccount: pubkeyAt(data, OFF_ORACLE_ACCOUNT),
    allowSwap: data[OFF_ALLOW_SWAP] === 1,
    targetRatioBps: readUintLE(data, OFF_TARGET_RATIO_BPS, 8),
    dovesOracle: pubkeyAt(data, OFF_DOVES_ORACLE),
    externalSwapFeeMultiplierBps: readUintLE(data, OFF_EXTERNAL_SWAP_FEE_MULTIPLIER_BPS, 8),
  };
}

interface DecodedPool {
  aumUsdOffset: bigint;
  feesOffset: bigint;
  custodies: Address[];
  swapBps: bigint;
  taxBps: bigint;
  stableSwapBps: bigint;
  stableSwapTaxBps: bigint;
  swapMultiplier: bigint;
  stableSwapMultiplier: bigint;
}

/**
 * Decode the Pool account's DYNAMIC layout: `name` (string) and `custodies`
 * (Vec<Pubkey>) are both variable-length, so every field after them shifts
 * with the pool's name length and custody count. Computed fresh every fetch
 * (never hardcoded) so a future custody addition never desyncs this adapter.
 */
function decodePool(pool: Address, data: Uint8Array): DecodedPool {
  if (!POOL_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error(`${SLUG} pool ${pool} is not a Pool account (discriminator mismatch)`);
  }
  const nameLen = Number(readUintLE(data, 8, 4));
  let off = 12 + nameLen;
  const custodyCount = Number(readUintLE(data, off, 4));
  off += 4;
  const custodies: Address[] = [];
  for (let i = 0; i < custodyCount; i++) {
    custodies.push(pubkeyAt(data, off + 32 * i));
  }
  off += 32 * custodyCount;
  const aumUsdOffset = BigInt(off);
  off += 16; // aumUsd: u128
  off += 16 + 16 + 8; // Limit: maxAumUsd(u128) + tokenWeightageBufferBps(u128) + buffer(u64)
  const feesOffset = BigInt(off);
  const feeU64 = (k: number): bigint => readUintLE(data, off + 8 * k, 8);
  return {
    aumUsdOffset,
    feesOffset,
    custodies,
    swapMultiplier: feeU64(0),
    stableSwapMultiplier: feeU64(1),
    swapBps: feeU64(3),
    taxBps: feeU64(4),
    stableSwapBps: feeU64(5),
    stableSwapTaxBps: feeU64(6),
  };
}

/**
 * Fetch + gate one directed (mintIn -> mintOut) JLP swap. Unlike every other
 * family, this takes the DIRECTED PAIR (not just a pool-hint address) — see
 * the module doc for why. `poolHint` is accepted for API symmetry with the
 * other families' `fetch(load, pool)` shape (and sanity-asserted equal to
 * the freshly-derived custodyIn PDA) but is not otherwise used: the pair
 * fully determines both custody PDAs.
 */
/**
 * `custodyIn` is the account to decode DIRECTLY (its `mint` field IS mintIn —
 * self-discovered, never taken on faith from a caller) — the address-source
 * derives it deterministically from `pair.inMint` (see ladder discovery
 * wiring), so this function never needs the input mint as a separate
 * argument. `mintOut` is the ONE piece of information genuinely external:
 * a basket has no single account embedding both sides, so SOMETHING must
 * name which of the OTHER custodies this trade targets. Both this function's
 * callers (the discovery resolver and the pre-codegen re-fetch) have it —
 * the former from the requested pair directly, the latter from the spec's
 * own `direction` string (this family stores `mintOut`'s base58 there, see
 * the consuming app SVM solver entry's FAMILIES entry) — so `fetchPoolConfig` never needs
 * a signature wider than every other family's `(load, pool)` PLUS this one
 * extra, always-a-plain-string `direction` parameter already threads through
 * both call sites unchanged.
 */
export async function fetchPerpsJlpConfig(
  load: AccountLoader,
  custodyIn: Address,
  mintOut: Address,
  now: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<PerpsJlpPoolConfig> {
  const [custodyInData, transferAuthority, perpetuals, eventAuthority] = await Promise.all([
    load(custodyIn),
    transferAuthorityPda(),
    perpetualsPda(),
    eventAuthorityPda(),
  ]);
  if (custodyInData === null) throw new Error(`${SLUG}: custody ${custodyIn} not found`);
  const dIn = decodeCustody(custodyIn, custodyInData);
  if (dIn.mint === mintOut) throw new Error(`${SLUG}: inMint and outMint must differ`);

  const custodyOut = await custodyPda(JLP_POOL_ADDRESS, mintOut);
  const [poolData, custodyOutData] = await Promise.all([load(JLP_POOL_ADDRESS), load(custodyOut)]);
  if (poolData === null) throw new Error(`${SLUG}: pool ${JLP_POOL_ADDRESS} account not found`);
  if (custodyOutData === null)
    throw new Error(
      `${SLUG}: custody ${custodyOut} (mint ${mintOut}) not found — mint not in the JLP basket`,
    );

  const pool = decodePool(JLP_POOL_ADDRESS, poolData);
  if (!pool.custodies.includes(custodyIn) || !pool.custodies.includes(custodyOut)) {
    throw new Error(
      `${SLUG}: derived custody not present in pool ${JLP_POOL_ADDRESS}'s custodies vec`,
    );
  }

  const dOut = decodeCustody(custodyOut, custodyOutData);
  if (dOut.mint !== mintOut)
    throw new Error(`${SLUG}: custody ${custodyOut} mint ${dOut.mint} != requested ${mintOut}`);
  if (!dIn.allowSwap)
    throw new Error(
      `${SLUG}: custody ${custodyIn} has swap disabled (Permissions.allowSwap == false)`,
    );
  if (!dOut.allowSwap)
    throw new Error(
      `${SLUG}: custody ${custodyOut} has swap disabled (Permissions.allowSwap == false)`,
    );

  // Tokenkeg-only (a Token-2022 transfer-fee/extension mint would desync wire
  // amounts — same restriction obric-v2/quantum apply to their own venues), so
  // detect a Token-2022 or un-routable mint via the shared data-shape resolver
  // and SELF-DROP the pair (the thrown error is the graceful-drop signal the
  // SvmRoute orchestrator catches). The LEGACY path is byte-identical: a classic
  // 82-byte mint classifies Tokenkeg with no extensions.
  const [mintInData, mintOutData] = await Promise.all([load(dIn.mint), load(mintOut)]);
  for (const [mint, mintData] of [
    [dIn.mint, mintInData],
    [mintOut, mintOutData],
  ] as const) {
    if (mintData === null) continue; // an unreadable mint falls back to the legacy assumption
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${SLUG}: dropping pair ${dIn.mint}/${mintOut} — mint ${mint} is Token-2022 (swap2 is legacy-SPL only here)`,
      );
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(
        `${SLUG}: dropping pair ${dIn.mint}/${mintOut} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
      );
    }
  }

  const [dovesInData, dovesOutData] = await Promise.all([
    load(dIn.dovesOracle),
    load(dOut.dovesOracle),
  ]);
  if (dovesInData === null || dovesOutData === null)
    throw new Error(`${SLUG}: Doves price feed account(s) not found`);
  if (dovesInData.length < DOVES_FEED_SIZE || dovesOutData.length < DOVES_FEED_SIZE) {
    throw new Error(`${SLUG}: Doves price feed account(s) undersized`);
  }
  const expoInRaw = dovesInData[DOVES_EXPO_OFFSET];
  const expoOutRaw = dovesOutData[DOVES_EXPO_OFFSET];
  const expoIn = expoInRaw >= 128 ? expoInRaw - 256 : expoInRaw; // i8
  const expoOut = expoOutRaw >= 128 ? expoOutRaw - 256 : expoOutRaw;
  const tsIn = readUintLE(dovesInData, DOVES_TIMESTAMP_OFFSET, 8);
  const tsOut = readUintLE(dovesOutData, DOVES_TIMESTAMP_OFFSET, 8);
  if (now - tsIn > DOVES_MAX_AGE_SEC || now - tsOut > DOVES_MAX_AGE_SEC) {
    throw new Error(
      `${SLUG}: a Doves feed is stale (age > ${DOVES_MAX_AGE_SEC}s) for pair ${dIn.mint}/${mintOut}`,
    );
  }

  const swapExponent = expoIn + ORACLE_EXPONENT_SCALE - expoOut;
  const fx = bakedDecimalScale(-dIn.decimals, swapExponent, -dOut.decimals);
  const usdIn = bakedDecimalScale(-dIn.decimals, expoIn, USD_TARGET_EXPONENT);
  const usdOut = bakedDecimalScale(-dOut.decimals, expoOut, USD_TARGET_EXPONENT);

  const isStableSwap = dIn.isStable && dOut.isStable;
  const baseFeeBps = isStableSwap ? pool.stableSwapBps : pool.swapBps;
  const taxFeeBps = isStableSwap ? pool.stableSwapTaxBps : pool.taxBps;
  const multiplier = isStableSwap ? pool.stableSwapMultiplier : pool.swapMultiplier;

  const extIn =
    dIn.externalSwapFeeMultiplierBps === 0n ? 10_000n : dIn.externalSwapFeeMultiplierBps;
  const extOut =
    dOut.externalSwapFeeMultiplierBps === 0n ? 10_000n : dOut.externalSwapFeeMultiplierBps;
  const externalMultiplierBps = extIn > extOut ? extIn : extOut;

  return {
    venue: SLUG,
    pool: JLP_POOL_ADDRESS,
    mintIn: dIn.mint,
    mintOut,
    custodyIn,
    custodyOut,
    tokenAccountIn: dIn.tokenAccount,
    tokenAccountOut: dOut.tokenAccount,
    dovesOracleIn: dIn.dovesOracle,
    dovesOracleOut: dOut.dovesOracle,
    pythAccountIn: dIn.pythAccount,
    pythAccountOut: dOut.pythAccount,
    tokenProgram: TOKEN_PROGRAM,
    transferAuthority,
    perpetuals,
    eventAuthority,
    decimalsIn: dIn.decimals,
    decimalsOut: dOut.decimals,
    fxScaleUp: fx.scaleUp,
    fxScaleDown: fx.scaleDown,
    usdScaleUpIn: usdIn.scaleUp,
    usdScaleDownIn: usdIn.scaleDown,
    usdScaleUpOut: usdOut.scaleUp,
    usdScaleDownOut: usdOut.scaleDown,
    isStableIn: dIn.isStable,
    isStableOut: dOut.isStable,
    targetRatioBpsIn: dIn.targetRatioBps,
    targetRatioBpsOut: dOut.targetRatioBps,
    baseFeeBps,
    taxFeeBps,
    multiplier,
    externalMultiplierBps,
    poolAumUsdOffset: pool.aumUsdOffset,
    poolFeesOffset: pool.feesOffset,
  };
}

/** Family facade for the recipe orchestrator (ladder-only — not in the v1 registry; see quantum/solfi-v2). */
export const perpsJlp = {
  slug: SLUG,
  programId: PERPS_JLP_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchPerpsJlpConfig,
};

export { perpsJlpConfig, ORACLE_PRICE_SCALE };
