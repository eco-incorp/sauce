/**
 * Obric V2 venue adapter — the prop-AMM oracle-anchored (P-A) family.
 *
 * Obric is an oracle-priced shifted-constant-product AMM: reserves ride a
 * virtual bigK curve RE-CENTERED on a live oracle mid, so the marginal price
 * at the center is the oracle ratio and bigK sets the depth. Unlike the other
 * SVM families (whose price is fully in the pool/vault state), Obric reads the
 * fast-moving LEVEL from a SEPARATE oracle account the swap already passes in
 * — the SVM analog of the EVM net-cache: bake the drift-invariant SHAPE (bigK,
 * targetX, fee, the reserves), read the fast oracle MID live and re-anchor.
 *
 * WHY P-A (the build-now prop-AMM): (1) the price level lives in a separate,
 * live-readable oracle account (Pyth-v2-format relay — documented layout:
 * expo i32 @20, agg.price i64 @208, agg.status u32 @224); (2) the swap is a
 * plain 12-account Anchor ix with NO instructions-sysvar introspection and no
 * maker-allowlist account (any signer with token accounts may swap); (3) the
 * quote curve is known (the official obric-solana SDK / IDL). Obric already
 * sits in third-party router CPI target sets. See the historical venue investigation for the
 * ranked prop-AMM ledger and the CPI-acceptance probe.
 *
 * The oracle-derivation caveat (honest): the on-chain program recomputes
 * multX/multY from the live oracle at swap time; the exact scaling is
 * transcribed from the official SDK (getPrice → expo −3, × decimalMult) and
 * cross-checked against the pool's STORED multX/multY (which the program
 * writes each swap) — the USDC feed's 1e10 @ expo −8 reproduces stored
 * multY=100000 exactly. The program is closed-source, so venue-exactness rests
 * on that SDK==program assumption plus the terminal minOut backstop; the
 * lamport-exact gate (fragment == referenceQuote) is unconditional. The
 * adapter is conservative on the fee REBATE (it charges the full feeMillionth,
 * omitting the rebalancing-trade discount) so predicted <= realized — one-
 * sided safe for minOut.
 *
 * Byte offsets verified against the obric_solana IDL (SSTradingPair) and a
 * real mainnet dump of pool AJ5HfGY32igLgUbDtfNRdrkjTSYkCVKdhmnFFfcZMJ1E.
 *
 * Original venue investigation (historical):
 * https://github.com/eco-incorp/sauce/blob/d3686430ee308994f95309a8c9b2d5930d71cf5d/docs/svm-venues.md
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { assertOracleExponent } from "../oracle-exponent.js";
import type { AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";
import { INSTRUCTIONS_SYSVAR } from "../../cpi-probe.js";
import type { CpiTier } from "../../cpi-probe.js";

const SLUG = "obric-v2";

export const OBRIC_V2_PROGRAM_ID = address("obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** The Pyth-v2-format relay program Obric migrated onto (documented layout). */
export const PYTH_V2_RELAY_OWNER = "Feed29BgSBmKrK5jQsLR4VcwJpJr1eHfg5sX4TQbLGrV";
/** Pyth-v2 magic at feed[0..4] LE (0xa1b2c3d4). */
const PYTH_V2_MAGIC = 0xa1b2c3d4n;
/** Pyth-v2 feed field offsets. */
const FEED_MAGIC_OFF = 0;
const FEED_EXPO_OFF = 20; // i32 LE
const FEED_PRICE_OFF = 208; // agg.price i64 LE
const FEED_STATUS_OFF = 224; // agg.status u32 LE (1 == Trading)

/** sha256('account:SSTradingPair')[0..8]. */
const POOL_DISCRIMINATOR = [0x3b, 0xde, 0x0f, 0xec, 0x62, 0x66, 0x5a, 0xe0];
/** sha256('global:swap')[0..8] (Obric's unified swap; == meteora's, both "global:swap"). */
export const OBRIC_SWAP_DISCRIMINATOR = [248, 198, 158, 145, 225, 117, 135, 200];

const POOL_ACCOUNT_SIZE = 666;

// SSTradingPair offsets (IDL-derived; see the field table in the historical venue investigation).
export const OFF_INITIALIZED = 8;
export const OFF_X_FEED = 9;
export const OFF_Y_FEED = 41;
export const OFF_RESERVE_X = 73;
export const OFF_RESERVE_Y = 105;
export const OFF_PROTO_FEE_X = 137;
export const OFF_PROTO_FEE_Y = 169;
export const OFF_MINT_X = 202;
export const OFF_MINT_Y = 234;
export const OFF_BIG_K = 274; // u128
export const OFF_TARGET_X = 290; // u64
export const OFF_MULT_X = 306; // u64 (stored — the sanity-band anchor)
export const OFF_MULT_Y = 314; // u64
export const OFF_FEE_MILLIONTH = 322; // u64
export const OFF_REBATE_PCT = 330; // u64
export const OFF_PROTO_FEE_SHARE = 338; // u64

const U64_MAX = (1n << 64n) - 1n;
/** Default sanity band (bps of the stored mult ratio): a wide gross-corruption guard for the documented P-A feed. */
export const OBRIC_DEFAULT_BAND_BPS = 2500n;

export interface ObricV2PoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'xToY' (default — mintX in, mintY out) | 'yToX'. */
  direction: "xToY" | "yToX";
  mintX: Address;
  mintY: Address;
  /** Vault token accounts (amount@64 read live for the reserves). */
  reserveXVault: Address;
  reserveYVault: Address;
  /** Protocol-fee vaults (the swap ix's account #7 is the OUTPUT side's). */
  protocolFeeX: Address;
  protocolFeeY: Address;
  feedX: Address;
  feedY: Address;
  /** Both mints share this token program (classic Tokenkeg — the recipe class). */
  tokenProgram: Address;
  /** Drift-invariant curve shape (baked): virtual-reserve product. */
  bigK: bigint;
  targetX: bigint;
  feeMillionth: bigint;
  /** Oracle scaling per side: mult = floor(rawPrice / div) * mul (reproduces the SDK getPrice + decimalMult). */
  divX: bigint;
  mulX: bigint;
  divY: bigint;
  mulY: bigint;
  /** Live price offset within each feed (Pyth-v2 relay: 208). */
  priceOffX: bigint;
  priceOffY: bigint;
  /** Sanity band (bps of the stored mult ratio); 0 disables. */
  bandBps: bigint;
  /** Fetch-time oracle snapshot (the quote re-reads the feeds live). */
  storedMultX: bigint;
  storedMultY: bigint;
  /** CPI-acceptance classification (P-A for the admitted Pyth-relay pools). */
  cpiTier: CpiTier;
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/** decimalMult per the SDK's updateTradingPairPrice (normalizes the price ratio to token units). */
function decimalMults(
  xDecimals: number,
  yDecimals: number,
): { decMultX: bigint; decMultY: bigint } {
  if (xDecimals > yDecimals)
    return { decMultX: 1n, decMultY: 10n ** BigInt(xDecimals - yDecimals) };
  if (yDecimals > xDecimals)
    return { decMultX: 10n ** BigInt(yDecimals - xDecimals), decMultY: 1n };
  return { decMultX: 1n, decMultY: 1n };
}

/**
 * Pyth-v2-relay feed scaling to the SDK's expo −3, folded with the token
 * decimalMult: mult = floor(rawPrice / div) * mul. For expo e:
 *   e < −3  → div = 10^(−3−e), mul = decimalMult;
 *   e >= −3 → div = 1,        mul = 10^(e+3) · decimalMult.
 *
 * `expo` is an oracle-controlled i32, and BOTH branches raise 10 to something
 * derived from it, so the range gate sits here at the exponentiation site rather
 * than at the caller — a future caller cannot route around it. `decimalMult` is
 * already-computed token-decimal math and is not re-checked (see
 * oracle-exponent.ts on why those two are not the same risk).
 */
function feedScale(
  expo: number,
  decimalMult: bigint,
  context: string,
): { div: bigint; mul: bigint } {
  assertOracleExponent("pyth-v2-price-account", expo, context);
  if (expo < -3) return { div: 10n ** BigInt(-3 - expo), mul: decimalMult };
  return { div: 1n, mul: 10n ** BigInt(expo + 3) * decimalMult };
}

interface DecodedFeed {
  expo: number;
  /** Recognized Pyth-v2-relay layout (documented, live-readable). */
  known: boolean;
}

/**
 * Classify + decode a feed by its documented Pyth-v2 magic (0xa1b2c3d4 @0) —
 * the bare AccountLoader gives bytes, not owner, so the magic (a stable
 * discriminator) is the layout anchor. Doves (0x17fc67bd) / Minimox
 * (0xcab93a6d) fail the magic and are treated as P-B (unpinned layout).
 */
function decodeFeed(data: Uint8Array): DecodedFeed {
  if (data.length < FEED_STATUS_OFF + 4) return { expo: 0, known: false };
  if (readUintLE(data, FEED_MAGIC_OFF, 4) !== PYTH_V2_MAGIC) return { expo: 0, known: false };
  const raw = readUintLE(data, FEED_EXPO_OFF, 4);
  const expo = raw >= 1n << 31n ? Number(raw - (1n << 32n)) : Number(raw); // i32
  return { expo, known: true };
}

interface DecodedPool {
  feedX: Address;
  feedY: Address;
  reserveXVault: Address;
  reserveYVault: Address;
  protocolFeeX: Address;
  protocolFeeY: Address;
  mintX: Address;
  mintY: Address;
  bigK: bigint;
  targetX: bigint;
  feeMillionth: bigint;
  storedMultX: bigint;
  storedMultY: bigint;
}

/** Decode + shape-gate the SSTradingPair account (named errors). */
function decodePool(pool: string, data: Uint8Array): DecodedPool {
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `obric-v2 pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  if (!POOL_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
    throw new Error(
      `obric-v2 pool ${pool} is not an SSTradingPair account (discriminator mismatch)`,
    );
  }
  if (data[OFF_INITIALIZED] !== 1) throw new Error(`obric-v2 pool ${pool} is not initialized`);
  const bigK = readUintLE(data, OFF_BIG_K, 16);
  if (bigK === 0n) {
    throw new Error(
      `obric-v2 pool ${pool} has bigK=0 (drained / never seeded) — no curve to quote`,
    );
  }
  return {
    feedX: pubkeyAt(data, OFF_X_FEED),
    feedY: pubkeyAt(data, OFF_Y_FEED),
    reserveXVault: pubkeyAt(data, OFF_RESERVE_X),
    reserveYVault: pubkeyAt(data, OFF_RESERVE_Y),
    protocolFeeX: pubkeyAt(data, OFF_PROTO_FEE_X),
    protocolFeeY: pubkeyAt(data, OFF_PROTO_FEE_Y),
    mintX: pubkeyAt(data, OFF_MINT_X),
    mintY: pubkeyAt(data, OFF_MINT_Y),
    bigK,
    targetX: readUintLE(data, OFF_TARGET_X, 8),
    feeMillionth: readUintLE(data, OFF_FEE_MILLIONTH, 8),
    storedMultX: readUintLE(data, OFF_MULT_X, 8),
    storedMultY: readUintLE(data, OFF_MULT_Y, 8),
  };
}

function obricConfig(cfg: PoolConfig): ObricV2PoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`obric-v2 adapter got a config for venue '${cfg.venue}'`);
  const c = cfg as ObricV2PoolConfig;
  if (c.direction !== "xToY" && c.direction !== "yToX") {
    throw new Error(`obric-v2 direction must be 'xToY' or 'yToX', got '${c.direction}'`);
  }
  return c;
}

export const obricV2 = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: OBRIC_V2_PROGRAM_ID,

  /**
   * Off-chain gate + oracle classification. Rejects: wrong size/disc,
   * uninitialized, bigK=0 (drained), token-2022 mints (Tokenkeg-only class),
   * and — the CPI-acceptance discriminant — a feed pointing at the
   * instructions sysvar (the introspecting P-C pools) or a feed whose layout
   * is not the documented Pyth-v2 relay (Doves/Minimox — P-B, unpinned layout).
   */
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<ObricV2PoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`obric-v2 pool ${pool} account not found`);
    const d = decodePool(pool, data);

    // CPI-acceptance static screen: a feed slot pointing at the instructions
    // sysvar means the swap introspects the enclosing transaction (P-C).
    if (d.feedX === INSTRUCTIONS_SYSVAR || d.feedY === INSTRUCTIONS_SYSVAR) {
      throw new Error(
        `obric-v2 pool ${pool} references the instructions sysvar as a price feed (introspecting swap — tier P-C, excluded)`,
      );
    }

    // Both mints must be classic Tokenkeg (the swap carries one token program).
    const [mintXData, mintYData] = await Promise.all([load(d.mintX), load(d.mintY)]);
    if (mintXData === null || mintYData === null) {
      throw new Error(`obric-v2 pool ${pool} mint account(s) not found`);
    }
    const [feedXData, feedYData] = await Promise.all([load(d.feedX), load(d.feedY)]);
    if (feedXData === null || feedYData === null) {
      throw new Error(`obric-v2 pool ${pool} price feed account(s) not found`);
    }
    // Mint owner = token program; the recipe is Tokenkeg-only (a token-2022
    // mint / transfer-fee extension would desync wire amounts from the curve).
    const dec = (mint: Address, mintData: Uint8Array): number => {
      if (mintData.length < 45)
        throw new Error(
          `obric-v2 pool ${pool} mint ${mint} is ${mintData.length} bytes, not an SPL mint`,
        );
      return mintData[44];
    };
    const xDecimals = dec(d.mintX, mintXData);
    const yDecimals = dec(d.mintY, mintYData);

    // Token-2022 safety: the swap carries one token program (Tokenkeg), so a
    // Token-2022 mint (or one carrying an un-routable extension) SELF-DROPS the
    // pool via a thrown, clearly-described error — the SvmRoute orchestrator
    // catches a fetchPoolConfig throw and drops the venue. The legacy path stays
    // byte-identical: a classic 82-byte mint classifies as legacy → no throw. We
    // reuse the mint bytes already loaded above for the decimals decode.
    for (const [mint, mintData] of [
      [d.mintX, mintXData],
      [d.mintY, mintYData],
    ] as const) {
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }

    // Classify each feed by its documented Pyth-v2 layout (magic + expo).
    const feedX = decodeFeed(feedXData);
    const feedY = decodeFeed(feedYData);
    if (!feedX.known || !feedY.known) {
      throw new Error(
        `obric-v2 pool ${pool} uses a non-Pyth-v2 relay feed (Doves/Minimox — layout not pinned; tier P-B, documented-but-not-built)`,
      );
    }

    const { decMultX, decMultY } = decimalMults(xDecimals, yDecimals);
    const sx = feedScale(feedX.expo, decMultX, `${SLUG} pool ${pool} feed X ${d.feedX}`);
    const sy = feedScale(feedY.expo, decMultY, `${SLUG} pool ${pool} feed Y ${d.feedY}`);

    return {
      venue: SLUG,
      pool,
      direction: "xToY",
      mintX: d.mintX,
      mintY: d.mintY,
      reserveXVault: d.reserveXVault,
      reserveYVault: d.reserveYVault,
      protocolFeeX: d.protocolFeeX,
      protocolFeeY: d.protocolFeeY,
      feedX: d.feedX,
      feedY: d.feedY,
      tokenProgram: TOKEN_PROGRAM,
      bigK: d.bigK,
      targetX: d.targetX,
      feeMillionth: d.feeMillionth,
      divX: sx.div,
      mulX: sx.mul,
      divY: sy.div,
      mulY: sy.mul,
      priceOffX: BigInt(FEED_PRICE_OFF),
      priceOffY: BigInt(FEED_PRICE_OFF),
      bandBps: OBRIC_DEFAULT_BAND_BPS,
      storedMultX: d.storedMultX,
      storedMultY: d.storedMultY,
      cpiTier: "P-A",
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = obricConfig(cfg);
    return [
      { ref: c.pool, address: c.pool },
      { ref: c.feedX, address: c.feedX },
      { ref: c.feedY, address: c.feedY },
      { ref: c.reserveXVault, address: c.reserveXVault },
      { ref: c.reserveYVault, address: c.reserveYVault },
    ];
  },

  /** v1 swap CPI (amount baked) — the unified `swap` ix. */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = obricConfig(cfg);
    if (amountIn <= 0n || amountIn > U64_MAX)
      throw new Error(`obric-v2 buildSwap amountIn must be a positive u64, got ${amountIn}`);
    const xToY = c.direction === "xToY";
    const data = new Uint8Array(8 + 1 + 8 + 8);
    data.set(OBRIC_SWAP_DISCRIMINATOR, 0);
    data[8] = xToY ? 1 : 0; // isXToY
    for (let b = 0; b < 8; b++) data[9 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[17] = 1; // minOutputAmt = 1 (the recipe's terminal delta owns the bound)
    return {
      programId: OBRIC_V2_PROGRAM_ID,
      data,
      accounts: swapAccounts(c, user, (ref, addr, w) => fixed(ref, addr, w)),
    };
  },
};

const fixed = (ref: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref, address: addr, writable: true } : { ref, address: addr };

/** The 12-account order for Obric's unified `swap` (shared by v1 buildSwap and v2 buildSwapV2). */
export function swapAccounts(
  c: ObricV2PoolConfig,
  user: SwapUser,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const xToY = c.direction === "xToY";
  const r = refFor ?? ((role: string): string => role);
  const userX = xToY ? user.inAta : user.outAta; // userTokenAccountX
  const userY = xToY ? user.outAta : user.inAta; // userTokenAccountY
  const protoFee = xToY ? c.protocolFeeY : c.protocolFeeX; // output-side protocol fee vault
  return [
    make(r("pool"), c.pool, true),
    make(r("mx"), c.mintX),
    make(r("my"), c.mintY),
    make(r("vx"), c.reserveXVault, true),
    make(r("vy"), c.reserveYVault, true),
    { ref: userX, writable: true },
    { ref: userY, writable: true },
    make(r("pf"), protoFee, true),
    make(r("fx"), c.feedX),
    make(r("fy"), c.feedY),
    { ref: user.owner, signer: true },
    make(r("tp"), c.tokenProgram),
  ];
}
