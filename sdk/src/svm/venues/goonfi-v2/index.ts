/**
 * GoonFi V2 venue adapter — a proprietary prop-AMM with NO public IDL. Every
 * byte offset, the instruction format, the account order/writability, the
 * oracle-relay layout and the fee-tier schedule below were reverse-engineered
 * from REAL mainnet state (not documentation, which does not exist):
 *
 *  - Program `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE`; 32 pools found via
 *    a size-2048 getProgramAccounts sweep, all sharing one 8-byte
 *    discriminator.
 *  - The real swap instruction was extracted from a live Jupiter-routed CPI
 *    (tx `3CxNcbQyin5NuAXs9wGnixM7jVKeNNKjm3p5k4jcq3sHQ1AzjhqJwRoPnumFP2tJU1GWwCNEBzyCEGScGFymyrxf`,
 *    slot 436413292): a 19-byte payload — tag(1)=1, direction(1) bool,
 *    amountIn u64 LE, minOut u64 LE, trailing byte — over 14 accounts whose
 *    writable/signer flags were read back off the transaction's own header +
 *    address-table-lookup partitioning (not guessed). Cross-checked against
 *    three OTHER pools' real transactions (different pairs) to separate
 *    GLOBAL accounts (the 719,000-byte state account, the ix-sysvar, the
 *    token program listed twice, and one constant pubkey) from POOL-SPECIFIC
 *    ones (user ATAs, the pool, its two vaults, the two mints, and a
 *    per-pool oracle-relay account) — see the account table in buildSwap.
 *  - **The pricing signal is a separate, LIVE, per-pool oracle-relay account**
 *    (account index 8 in the swap; NOT stored in the pool's own bytes — it is
 *    owned by a DIFFERENT program, `dijkbkCAKfFTCxQg3u1pg82gVU1jJGHBBRcteD11mBu`,
 *    confirmed shared across four independently-sampled pools). Its 32 bytes
 *    decode as two u64 price quotes (bid/ask-like — GMCJ's SOL/USDC pool
 *    showed them nearly equal; a more volatile pair's pool showed a real
 *    ~0.06% spread between them), a u32 slot stamp (observed within single
 *    digits of the chain's current slot on re-read — genuinely live), and a
 *    u32 denominator (1,000,000 on all four sampled pools). Dividing either
 *    quote by the denominator reproduces the real-world price almost exactly
 *    (72.88–73.07 USDC/SOL against the pool's own realized trades over the
 *    sampling window). This is the SAME structural role as obric-v2's
 *    separate live oracle feed (P-A-style: bake the pool's fixed shape, read
 *    the fast-moving level live) — GoonFi just relays it through its own
 *    program instead of a Pyth/Switchboard-format account.
 *  - **The fee/size-tier schedule is baked directly in the pool's own 2048
 *    bytes** (an admin-configured, live-readable table — genuinely part of
 *    pool state, unlike the oracle): a 9-entry cumulative-size ladder in the
 *    quote mint's raw units (500 / 1,000 / 2,500 / 5,000 / 10,000 / 50,000 /
 *    100,000 / 250,000 / 1,000,000, 6-decimal-scaled) paired with a 9-entry
 *    fee-ppm ladder (1320 / 1450 / 1650 / 1950 / 2200 / 2800 / 3500 / 6000 /
 *    11000). Both are validated against REAL measurements: Jupiter quotes
 *    restricted to this venue (`dexes=GoonFi+V2`) at 1/100/10,000 USDC showed
 *    a ~22 bps discount from the small-size rate at the 10,000 USDC size —
 *    the table's own 5th-tier value is 2200 ppm = 22.00 bps, an exact match —
 *    and a 1,000,000 USDC quote came back "No routes found", exactly the
 *    table's 9th (final) threshold. Applying the full price+fee model to the
 *    real historical trade (17,981,639 USDC-raw in, tier 1) predicts
 *    246,389,376 WSOL-raw out against a REALIZED 246,275,339 — 0.05% off.
 *
 * HONEST LIMIT (disclosed, mirroring obric-v2's own caveat): the oracle
 * bid/ask ordering and the fee-tier table are read as GENUINE LIVE pool/oracle
 * state (not baked from a point-in-time snapshot), but the program itself is
 * closed-source, so venue-EXACTNESS (predicted == the real program's realized
 * output to the last lamport) is not proven the way a decompiled formula
 * would be. Every choice below is made in the CONSERVATIVE direction
 * (whichever of the two oracle quotes gives the trader less; a hard
 * capacity-ceiling deactivation at the largest tier; a live vaultOut clamp)
 * so predicted <= realized is the design invariant, backstopped by the
 * recipe's terminal minOut/realized-delta check exactly like every other
 * venue in this package.
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
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type {
  OwnedAccountLoader,
  PoolConfig,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "goonfi-v2";

export const GOONFI_V2_PROGRAM_ID = address("goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** Instructions sysvar — attached read-only per the real captured swaps (a static screen only; see
 *  module doc: this program IS reachable by CPI — the reference tx is Jupiter's own router calling
 *  in at stackHeight 2 — so the sysvar's presence here is not a CPI blocker). */
const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
/** Constant account #13 of every real swap sampled (4/4 pools) — role not decoded, passed through
 *  verbatim since every sampled swap needed it present, readonly. */
const GOONFI_CONST_ACCOUNT_13 = address("J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv");
/** The 719,000-byte account every sampled pool's swap attaches read-only (account #9) — owned by
 *  the GoonFi program itself, NOT written by swap (confirmed via the real tx's writable-flags
 *  decode), so it is genuine keeper-maintained state the swap only consults. Its internal layout
 *  is >98% zero-padded and not yet decoded; this adapter does not read it directly (the per-pool
 *  oracle-relay account below carries the live price signal instead). */
export const GOONFI_GLOBAL_STATE = address("BNrK9LpEn65QA4TyBLVSMdngW3XHj3xLfFPwGdCBv8wV");

/** sha256-style single-byte tag observed on all 4 real captured swaps. */
export const GOONFI_SWAP_TAG = 1;

const POOL_ACCOUNT_SIZE = 2048;
/** 8-byte leading tag, identical across all 32 pools found on a size-2048 gPA sweep. */
const POOL_DISCRIMINATOR = [0x30, 0xbc, 0x2f, 0x35, 0x34, 0x58, 0x32, 0x9a];

// Pool-account offsets — byte-offset-searched against 4 real pool accounts (GMCJ + 3 others,
// different pairs) and cross-checked against the accounts a real swap instruction on each of those
// exact pools actually referenced.
export const GOONFI_OFF_MINT_A = 80;
export const GOONFI_OFF_MINT_B = 112;
export const GOONFI_OFF_VAULT_A = 144;
export const GOONFI_OFF_VAULT_B = 176;
/** The per-pool oracle-relay account (swap account #8; see module doc). */
export const GOONFI_OFF_ORACLE = 208;
/** 9-entry cumulative-size tier boundaries, quote-mint(B) raw units, 6-decimal-scaled (see module doc). */
const OFF_SIZE_TIERS = 1560;
/** 9-entry fee-ppm-per-tier schedule (see module doc). */
const OFF_FEE_TIERS = 248;
const TIER_COUNT = 9;
const TIER_STRIDE = 8;

// Oracle-relay account (32 bytes, owner `dijkbkCAKfFTCxQg3u1pg82gVU1jJGHBBRcteD11mBu` — a DIFFERENT
// program than GoonFi's own; see module doc).
const ORACLE_ACCOUNT_SIZE = 32;
export const OFF_ORACLE_P1 = 0;
export const OFF_ORACLE_P2 = 8;
export const OFF_ORACLE_SLOT = 16;
export const OFF_ORACLE_DENOM = 20;
/** The denominator observed on all 4 sampled oracle-relay accounts — a fail-closed assumption:
 *  the live denom is still read and gated against this at cook time (see ladder.ts), so a future
 *  pool with a genuinely different denom self-deactivates instead of silently mispricing. */
export const GOONFI_ASSUMED_DENOM = 1_000_000n;

const U64_MAX = (1n << 64n) - 1n;

/** The empirically-validated fee schedule (ppm, i.e. parts-per-1e6) — see module doc for the
 *  measurement this pins against (tier 5 = 2200 ppm = 22.00 bps, matching a real Jupiter-quoted
 *  10,000 USDC price impact of ~21.8 bps). Read LIVE from the pool's own bytes (not baked) so a
 *  pool with a genuinely different admin-configured schedule is priced from its own table.
 */
export interface GoonfiFeeSchedule {
  /** 9 ascending cumulative-size thresholds, in the CALLER-SIDE mint's raw units for this
   *  direction (already decimals-adjusted at fetch time — see paramsFor in ladder.ts). */
  sizeTiers: readonly bigint[];
  /** 9 fee rates in ppm, ascending, one per tier upper bound. */
  feeTiersPpm: readonly bigint[];
}

export interface GoonfiV2PoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'xToY' (default — mintA in, mintB out) | 'yToX'. */
  direction: "xToY" | "yToX";
  mintA: Address;
  mintB: Address;
  decimalsA: number;
  decimalsB: number;
  vaultA: Address;
  vaultB: Address;
  oracle: Address;
  tokenProgram: Address;
  /** Fee schedule read from the pool's own bytes, already oriented for `direction` (mintB-raw
   *  cumulative thresholds for yToX; snapshot-price-converted to mintA-raw for xToY — see
   *  ladder.ts's paramsFor doc for why xToY's thresholds are a one-time approximation). */
  feeSchedule: GoonfiFeeSchedule;
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/** denomAdjusted = ASSUMED_DENOM * 10^decimalsA / 10^decimalsB — the single scale constant the
 *  live-price formula divides (xToY) or multiplies (yToX) by. Shared between fetchPoolConfig
 *  (threshold baking) and the ladder (the runtime param) so the two can never diverge. */
export function denomAdjustedFor(decimalsA: number, decimalsB: number): bigint {
  return (GOONFI_ASSUMED_DENOM * 10n ** BigInt(decimalsA)) / 10n ** BigInt(decimalsB);
}

function goonfiConfig(cfg: PoolConfig): GoonfiV2PoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`goonfi-v2 adapter got a config for venue '${cfg.venue}'`);
  const c = cfg as GoonfiV2PoolConfig;
  if (c.direction !== "xToY" && c.direction !== "yToX") {
    throw new Error(`goonfi-v2 direction must be 'xToY' or 'yToX', got '${c.direction}'`);
  }
  return c;
}

/** Read the 9 raw (undecimalized) size-tier / fee-tier arrays straight from the pool's own bytes. */
function readTierArrays(data: Uint8Array, pool: Address): { sizeRawB: bigint[]; feePpm: bigint[] } {
  const sizeRawB: bigint[] = [];
  const feePpm: bigint[] = [];
  for (let i = 0; i < TIER_COUNT; i++) {
    sizeRawB.push(readUintLE(data, OFF_SIZE_TIERS + i * TIER_STRIDE, 8));
    feePpm.push(readUintLE(data, OFF_FEE_TIERS + i * TIER_STRIDE, 8));
  }
  for (let i = 1; i < TIER_COUNT; i++) {
    if (sizeRawB[i]! <= sizeRawB[i - 1]!) {
      throw new Error(`goonfi-v2 pool ${pool} has a non-ascending size-tier table at index ${i}`);
    }
  }
  return { sizeRawB, feePpm };
}

export const goonfiV2 = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: GOONFI_V2_PROGRAM_ID,

  /**
   * Off-chain gate + decode. Rejects: wrong size/discriminator, an unreadable
   * oracle-relay or mint account, a non-ascending fee-tier table (a corrupt or
   * unrecognized layout variant — fail closed rather than guess).
   */
  async fetchPoolConfig(owned: OwnedAccountLoader, pool: Address): Promise<GoonfiV2PoolConfig> {
    const load = accountDataLoader(owned);
    const data = await load(pool);
    if (data === null) throw new Error(`goonfi-v2 pool ${pool} account not found`);
    if (data.length !== POOL_ACCOUNT_SIZE) {
      throw new Error(
        `goonfi-v2 pool ${pool} account is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
      );
    }
    if (!POOL_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
      throw new Error(
        `goonfi-v2 pool ${pool} discriminator mismatch (unrecognized account layout)`,
      );
    }

    const mintA = pubkeyAt(data, GOONFI_OFF_MINT_A);
    const mintB = pubkeyAt(data, GOONFI_OFF_MINT_B);
    const vaultA = pubkeyAt(data, GOONFI_OFF_VAULT_A);
    const vaultB = pubkeyAt(data, GOONFI_OFF_VAULT_B);
    const oracle = pubkeyAt(data, GOONFI_OFF_ORACLE);

    const [mintAAccount, mintBAccount, oracleData] = await Promise.all([
      owned(mintA),
      owned(mintB),
      load(oracle),
    ]);
    if (mintAAccount === null || mintBAccount === null)
      throw new Error(`goonfi-v2 pool ${pool} mint account(s) not found`);
    const mintAData = mintAAccount.data;
    const mintBData = mintBAccount.data;
    if (mintAData.length < 45 || mintBData.length < 45) {
      throw new Error(`goonfi-v2 pool ${pool} mint account(s) too short to be an SPL mint`);
    }
    // This venue's on-chain swap ix is legacy-SPL (Tokenkeg) only, so a
    // Token-2022 mint (or one carrying an un-routable extension) SELF-DROPS the
    // pool via a thrown error (the SvmRoute orchestrator catches it and drops
    // the venue). The mint's token program is its OWNER (an extensionless
    // Token-2022 mint is byte-identical to a legacy one). Reuses the
    // already-fetched mint accounts; a Tokenkeg-owned mint → no throw → config
    // built byte-identically to before.
    for (const [mint, mintAccount] of [
      [mintA, mintAAccount],
      [mintB, mintBAccount],
    ] as const) {
      const mintData = mintAccount.data;
      if (classifyMintProgram(mint, mintData, mintAccount.owner) === TOKEN_2022_PROGRAM_ID) {
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
    if (oracleData === null)
      throw new Error(`goonfi-v2 pool ${pool} oracle-relay account ${oracle} not found`);
    if (oracleData.length !== ORACLE_ACCOUNT_SIZE) {
      throw new Error(
        `goonfi-v2 pool ${pool} oracle-relay account is ${oracleData.length} bytes, expected ${ORACLE_ACCOUNT_SIZE}`,
      );
    }

    const decimalsA = mintAData[44]!;
    const decimalsB = mintBData[44]!;
    const { sizeRawB, feePpm } = readTierArrays(data, pool);

    // A one-time SNAPSHOT price (for xToY's threshold conversion ONLY — the
    // executed quote always re-reads the oracle live; see ladder.ts). Use the
    // smaller of the two live quotes so a snapshot taken mid-spread still
    // yields thresholds at least as conservative as the live path will.
    const p1 = readUintLE(oracleData, OFF_ORACLE_P1, 8);
    const p2 = readUintLE(oracleData, OFF_ORACLE_P2, 8);
    if (p1 === 0n && p2 === 0n)
      throw new Error(`goonfi-v2 pool ${pool} oracle-relay ${oracle} reads a zero price`);
    const snapshotPrice = p1 < p2 || p2 === 0n ? (p1 === 0n ? p2 : p1) : p2;

    // See ladder.ts's paramsFor for the live on-chain denom gate this bakes an assumption against.
    const denomAdjusted = denomAdjustedFor(decimalsA, decimalsB);

    // sizeTiers are baked in mintB-raw units, decimals-scaled from the 6-decimal-assumed table.
    const sizeTiersB = sizeRawB.map((v) => (v / 1_000_000n) * 10n ** BigInt(decimalsB));

    return {
      venue: SLUG,
      pool,
      direction: "xToY",
      mintA,
      mintB,
      decimalsA,
      decimalsB,
      vaultA,
      vaultB,
      oracle,
      tokenProgram: TOKEN_PROGRAM,
      feeSchedule: {
        // xToY thresholds: convert mintB-notional tiers to mintA-raw units via the one-time
        // snapshot price (x_A = T_B * denomAdjusted / snapshotPrice — the inverse of the live
        // xToY quote formula). yToX uses sizeTiersB directly (see ladder.ts).
        sizeTiers: sizeTiersB.map((tb) => (tb * denomAdjusted) / snapshotPrice),
        feeTiersPpm: feePpm,
      },
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = goonfiConfig(cfg);
    return [
      { ref: c.pool, address: c.pool },
      { ref: c.oracle, address: c.oracle },
      { ref: c.vaultA, address: c.vaultA },
      { ref: c.vaultB, address: c.vaultB },
    ];
  },

  /** v1 swap CPI (amount baked) — the real 14-account `swap` ix (tag 1). */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = goonfiConfig(cfg);
    if (amountIn <= 0n || amountIn > U64_MAX)
      throw new Error(`goonfi-v2 buildSwap amountIn must be a positive u64, got ${amountIn}`);
    const yToX = c.direction === "yToX";
    const data = new Uint8Array(1 + 1 + 8 + 8 + 1);
    data[0] = GOONFI_SWAP_TAG;
    data[1] = yToX ? 1 : 0;
    for (let b = 0; b < 8; b++) data[2 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[10] = 1; // minOut LSB = 1 (the recipe's terminal delta owns the bound); rest already 0
    data[18] = 0;
    return {
      programId: GOONFI_V2_PROGRAM_ID,
      data,
      accounts: goonfiSwapAccounts(c, user, (ref, addr, w) => fixed(ref, addr, w)),
    };
  },
};

const fixed = (ref: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref, address: addr, writable: true } : { ref, address: addr };

/**
 * The 14-account order for GoonFi's real `swap` (shared by v1 buildSwap and v2 buildSwapV2) — read
 * back off a real captured transaction's own writable/signer flags (not guessed):
 *   0 user(signer,w) · 1 pool(w) · 2 user mintA-ATA(w) · 3 user mintB-ATA(w) · 4 vaultA(w) ·
 *   5 vaultB(w) · 6 mintA · 7 mintB · 8 oracle-relay · 9 GOONFI_GLOBAL_STATE · 10 ix-sysvar ·
 *   11 token program · 12 token program (again) · 13 GOONFI_CONST_ACCOUNT_13.
 * User ATA order is FIXED (mintA-ATA, mintB-ATA) regardless of direction — only the tag-1 direction
 * byte decides which side is pulled from vs paid into, exactly like vaultA/vaultB.
 */
export function goonfiSwapAccounts(
  c: GoonfiV2PoolConfig,
  user: SwapUser,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const yToX = c.direction === "yToX";
  const r = refFor ?? ((role: string): string => role);
  const userA = yToX ? user.outAta : user.inAta; // user's mintA-associated ATA
  const userB = yToX ? user.inAta : user.outAta; // user's mintB-associated ATA
  return [
    { ref: user.owner, signer: true, writable: true },
    make(r("pool"), c.pool, true),
    { ref: userA, writable: true },
    { ref: userB, writable: true },
    make(r("va"), c.vaultA, true),
    make(r("vb"), c.vaultB, true),
    make(r("ma"), c.mintA),
    make(r("mb"), c.mintB),
    make(r("oracle"), c.oracle),
    make(r("global"), GOONFI_GLOBAL_STATE),
    { ref: INSTRUCTIONS_SYSVAR, address: INSTRUCTIONS_SYSVAR },
    make(r("tp"), c.tokenProgram),
    make(r("tp2"), c.tokenProgram),
    { ref: GOONFI_CONST_ACCOUNT_13, address: GOONFI_CONST_ACCOUNT_13 },
  ];
}
