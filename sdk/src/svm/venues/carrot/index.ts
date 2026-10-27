/**
 * Carrot Protocol vault ladder — a NAV-priced, multi-asset stablecoin vault
 * (issue/redeem against a shared basket), NOT a 2-mint AMM pool. One
 * singleton on-chain `Vault` account (`FfCRL34rkJiMiX5emNDrYp3MdWH2mES3FvDQyFppqgpJ`,
 * a PDA of `["vault", CRT_MINT]` under `CARROT_PROGRAM_ID`) currently holds
 * three basket assets (USDC/USDT/pyUSD) and issues/redeems a single share
 * token (CRT, Token-2022). This adapter serves SIX directed pairs off that
 * one account — `issue:<assetId>` (asset -> CRT) and `redeem:<assetId>`
 * (CRT -> asset) for each basket asset — via `carrotAllDirections` (see
 * `the consuming app SVM solver entry`'s FAMILIES dispatch generalization it requires).
 *
 * GROUND TRUTH: no official IDL/program source is public. Layout, instruction
 * discriminators, and the account list are taken from the reverse-engineered
 * `carrot-sdk` crate (github.com/hogyzen12/carrot-sdk, licensed under MIT as
 * declared in its Cargo.toml, see THIRD_PARTY_NOTICES.md; matches an
 * observed 4,872-byte Anchor IDL blob) and INDEPENDENTLY CONFIRMED against
 * the real deployed program:
 *   - the byte layout below was decoded against the REAL vault account
 *     (`FfCRL34rkJiMiX5emNDrYp3MdWH2mES3FvDQyFppqgpJ`, 852 bytes, 3 assets,
 *     22+ strategies) and cross-checked field-by-field against the crate's
 *     `Vault`/`Fee`/`Asset`/`StrategyRecord` Borsh structs;
 *   - the `issue`/`redeem` account list and instruction discriminators were
 *     PROVEN via six real `simulateTransaction` dry-runs (sigVerify:false,
 *     no funds moved, an existing funded mainnet wallet's own ATAs as
 *     depositor/dest) against the live program — three ISSUE sizes
 *     (0.1/1/4 USDC -> 1,735,398 / 17,353,982 / 69,415,929 CRT-raw, matching
 *     this ladder's own formula to ~0.04%, fully attributable to ordinary
 *     mainnet state drift between the off-chain snapshot and the later
 *     simulateTransaction call — see "VALIDATION" below) and three REDEEM
 *     sizes (100/200/486 CRT-raw -> 5/11/27 USDC-raw, bit-exact at this dust
 *     scale). The real CPI needs ~232,244 CU (see `../budget.ts`'s
 *     `CU_FAMILIES.carrot`) — the framework's default 200,000 CU budget is
 *     NOT enough; every issue/redeem needs an explicit ComputeBudget bump.
 *
 * NAV FORMULA (the "single-asset path" this integration ships): the real
 * `issue`/`redeem` account list carries, per basket asset, ONLY `[vaultAta,
 * oracle]` as remaining accounts — NO strategy account ever rides the
 * instruction (confirmed both by the crate's `Vault::get_remaining_accounts`
 * source AND by the six real dry-runs above succeeding with exactly that
 * account set). This means the on-chain program cannot read a strategy's
 * LIVE external-protocol position during a swap at all — it can only value
 * each basket asset from what the instruction actually attaches: that
 * asset's own vault-held ATA balance and its oracle price. The vault's own
 * cached `StrategyRecord.balance` ledger (deployed-to-marginfi/klend/solend/
 * mango/drift positions) is therefore NOT part of the on-chain NAV this
 * swap computes — confirmed numerically: modeling NAV as
 * Σ(vaultAta·price) alone reproduces the six measured dry-runs to ~0.04%
 * (ordinary same-second price/state drift); including the cached strategy
 * balances in NAV is off by ~0.33%, an order of magnitude worse and NOT
 * explained by drift. So: **no marginfi/klend/solend/mango/drift adaptor is
 * needed at all for this swap path** — the plan text's premise that one is
 * required doesn't hold once you look at what accounts the real CPI
 * actually reads. This corrects, rather than follows, that premise.
 *   NAV_common = Σ_assets  ataBalance_i · oraclePrice_i · scale_i
 *   issue:  sharesOut = floor(x · price_t · scale_t · supply / NAV_common)
 *   redeem: grossCommon = floor(x · NAV_common / supply)
 *           grossOut    = floor(grossCommon / (price_t · scale_t))
 *           netOut      = grossOut − floor(grossOut · redemptionFeeBps / 10000)
 *           netOut      = min(netOut, ataBalance_t)   — SATURATING capacity
 *             clamp (see "CAPACITY" below), never a cliff to zero.
 * `scale_i = 10^(CARROT_TARGET_SCALE + oracleExponent_i − decimals_i)` is a
 * per-asset, fetch-time-baked (never live-computed on-chain — SauceScript has
 * no exponentiation intrinsic) integer factor that puts every asset's
 * ata·price term on one common denomination before summing; it is 10,000 for
 * all three known assets today (decimals=6, oracle exponent=−8 uniformly),
 * derived generically (not hardcoded to 6/−8) so a future basket asset with
 * different decimals/exponent needs no code change. All arithmetic is plain
 * BigInt multiply/floor-divide — the intermediate products here (at most
 * ~1e13 balance × ~1e8 price × 1e4 scale ≈ 1e25 per term) stay far under a
 * u256 word, so no `Math.mulDiv` wide-multiply is needed (see obric-v2's
 * ladder for the same plain-arithmetic convention with oracle-scaled terms).
 *
 * CAPACITY: `issue` is genuinely unbounded pool-side (any deposit mints
 * proportional shares, matching sanctum-stake-pool's "no curvature to
 * misrepresent" reasoning) — `defaultRungs` would lose nothing at 2, but
 * this family is pinned at the framework's CP default (4, via
 * `CU_FAMILIES.carrot.kind = 'cp'`) because `redeem` is NOT unbounded: its
 * payout is a plain SPL transfer out of `vaultAta_t`, so redeeming more
 * shares than that asset's live vault balance covers would REVERT the real
 * CPI atomically (and a launched CPI failure aborts the whole SVM cook — no
 * execution-time catch). `netOut = min(computed, ataBalance_t)` SATURATES
 * the curve instead of collapsing it — monotone non-decreasing, flat past
 * capacity — exactly the shape the merge needs to keep this venue
 * electable near its cap rather than allocating it zero (see
 * `docs`/CLAUDE.md's "a coarse or non-monotone ladder gets allocated ZERO"
 * note); the extra rungs (vs. issue's 2 would suffice) buy the merge enough
 * resolution to see the kink.
 *
 * SELF-DROP SCOPE: the plan text anticipated self-dropping "when an asset's
 * strategy account is unreadable" — but per the NAV formula above, no
 * strategy account is ever read, so that specific failure mode cannot arise.
 * The analogous, CORRECTLY-SCOPED self-drop this adapter implements is: the
 * WHOLE vault self-drops (fetchPoolConfig throws, caught by
 * `resolveSvmPoolSpec`) if the vault is paused, holds more than
 * `CARROT_MAX_ASSETS` basket assets (a fail-loud cap, not a silent
 * truncation — see that constant), or if ANY basket asset's mint/ata/oracle
 * account is missing or fails its shape gate — because NAV_common is a JOINT
 * sum over every basket asset, one bad asset makes every direction's quote
 * wrong, not just that asset's own. `entry.gate` additionally self-drops the
 * SPECIFIC direction being resolved if its own oracle reading is stale
 * (`now − publishTime` beyond `MAX_ORACLE_STALENESS_SECONDS`) — a per-
 * direction, not whole-vault, condition.
 *
 * TOKEN PROGRAM: CRT and pyUSD are Token-2022; USDC/USDT are classic
 * Tokenkeg — this mirrors the reference SDK's OWN hardcoded
 * `get_token_program_id`. A mint's token program is its OWNER (a Token-2022
 * mint with zero extensions is byte-identical in its first 82 bytes to a
 * classic mint), which `fetchPoolConfig`'s loader now carries; but
 * `CARROT_TOKEN_2022_MINTS` is public surface that names the known set for a
 * caller that picks the program without reading the mint, so it stays.
 *
 * DISCOVERY: this is a SINGLETON (one vault, ever) with a basket, not a
 * "many pools, one 2-mint pair each" family — it does not fit
 * `SVM_FAMILY_FILTERS`' generic getProgramAccounts memcmp shape (there is
 * nothing to scan for, and the second mint of any pair lives at a
 * per-asset-index offset inside a Vec, not one fixed offset). It is wired as
 * a bespoke, zero-RPC candidate emission in `the consuming app SVM discovery module`
 * instead — see that file's `carrotCandidatesFor`.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { assertOracleExponent } from "../oracle-exponent.js";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";

export const CARROT_PROGRAM_ID = address("CarrotwivhMpDnm27EHmRLeQ683Z1PufuqEmBZvD282s");
export const CRT_MINT = address("CRTx1JouZhzSU6XytsE42UQraoGqiHgxabocVfARTy2s");
/** The one deployed vault — a PDA of `["vault", CRT_MINT]`, singleton today. */
export const CARROT_VAULT_ADDRESS = address("FfCRL34rkJiMiX5emNDrYp3MdWH2mES3FvDQyFppqgpJ");

/** See the module header's TOKEN PROGRAM note — CRT (shares) plus pyUSD are the only Token-2022 mints today. */
export const CARROT_TOKEN_2022_MINTS: ReadonlySet<Address> = new Set([
  CRT_MINT,
  address("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"), // pyUSD
]);

const ATA_AMOUNT_OFFSET = 64;
const MINT_SUPPLY_OFFSET = 36;

// Sequential Vault layout (confirmed byte-exact against the real 852-byte account — see module
// header): authority@8 (32), shares@40 (32), fee@72 (30: u16+u64+u16+i64+u64+u16), paused@102 (1),
// assetIndex@103 (2), strategyIndex@105 (2), then `assets: Vec<Asset>` (u32 len @107, each element
// asset_id(2)+mint(32)+decimals(1)+ata(32)+oracle(32) = 99 bytes) — `strategies: Vec<StrategyRecord>`
// follows but is NEVER READ here (see the module header's NAV FORMULA note: no strategy value ever
// rides the real issue/redeem CPI).
const OFF_SHARES = 40;
const OFF_FEE_REDEMPTION_BPS = 72;
const OFF_PAUSED = 102;
const OFF_ASSETS_LEN = 107;
const ASSET_FIRST_OFFSET = 111;
const ASSET_STRUCT_SIZE = 99; // 2 (asset_id) + 32 (mint) + 1 (decimals) + 32 (ata) + 32 (oracle)

/**
 * Fail-loud cap on basket size (not a silent truncation) — see the module
 * header's SELF-DROP SCOPE note. The vault has held exactly 3 assets
 * (USDC/USDT/pyUSD) for its entire observed history; `paramCount` below is
 * sized for this. A real 4th-asset addition needs this constant (and
 * `paramCount`) bumped, not a silent misquote.
 */
export const CARROT_MAX_ASSETS = 3;

/** Pyth `PriceUpdateV2` (pyth-solana-receiver) layout, confirmed live against all 3 basket oracles. */
const PYTH_RECEIVER_PROGRAM_ID = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
// disc(8) + write_authority(32) = 40 — the verification-level tag sits right after.
const ORACLE_VERIFICATION_TAG_OFFSET = 40;
/** `VerificationLevel::Partial{num_signatures}` (tag 0, +1 byte) vs `::Full` (tag 1, +0 bytes). */
const ORACLE_VERIFICATION_PARTIAL_TAG = 0;
const ORACLE_VERIFICATION_FULL_TAG = 1;
const ORACLE_FEED_ID_SIZE = 32;
/** Common target scale (see module header's NAV FORMULA note) — arbitrary but fixed; matches this repo's existing "wad"-style 1e18 convention elsewhere. */
const CARROT_TARGET_SCALE = 18;
/** Pyth pull-oracle price update cadence is sub-second in practice; 5 minutes is a generous, not a tight, staleness bound. */
const MAX_ORACLE_STALENESS_SECONDS = 300n;

const U64_MAX = (1n << 64n) - 1n;
const addressDecoder = getAddressDecoder();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  addressDecoder.decode(data.subarray(offset, offset + 32));

export interface CarrotAssetSnapshot {
  /** The on-chain `asset_id` (stable identity — NOT the array index, which can shift if an asset is ever removed). */
  assetId: number;
  mint: Address;
  decimals: number;
  /** The vault's own ATA for this asset — read live on-chain (balance) at cook time. */
  ata: Address;
  oracle: Address;
  /** Baked absolute byte offset of the oracle's live i64 price field (73 for `Full`, 74 for `Partial` — see module header). */
  priceOffset: number;
  /** `10^(CARROT_TARGET_SCALE + oracleExponent - decimals)` — see module header. */
  scale: bigint;
  /** Fetch-time snapshot, used ONLY for the prepare-time staleness/positivity gate — the fragment re-reads price live. */
  priceSnapshot: bigint;
  publishTime: bigint;
}

export interface CarrotPoolConfig extends PoolConfig {
  venue: "carrot";
  sharesMint: Address;
  /** Vault-level redemption fee, bps (1 unit = 1/10000) — snapshotted at fetch time, re-staged like any other family's fee param. */
  redemptionFeeBps: bigint;
  /** Every basket asset, in vault order — ALWAYS all of them (see module header's SELF-DROP SCOPE note). */
  assets: readonly CarrotAssetSnapshot[];
  /** `issue:<assetId>` | `redeem:<assetId>` — see module header. */
  direction: string;
}

export interface CarrotDirection {
  op: "issue" | "redeem";
  assetId: number;
}

export function parseCarrotDirection(direction: string): CarrotDirection {
  const m = /^(issue|redeem):(\d+)$/.exec(direction);
  if (m === null)
    throw new Error(
      `carrot direction must be 'issue:<assetId>' or 'redeem:<assetId>', got '${direction}'`,
    );
  return { op: m[1] as "issue" | "redeem", assetId: Number(m[2]) };
}

function carrotConfig(cfg: PoolConfig): CarrotPoolConfig {
  if (cfg.venue !== "carrot")
    throw new Error(`carrot ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as CarrotPoolConfig;
}

function requireAsset(cfg: CarrotPoolConfig, assetId: number): CarrotAssetSnapshot {
  const asset = cfg.assets.find((a) => a.assetId === assetId);
  if (asset === undefined) {
    throw new Error(
      `carrot vault ${cfg.pool}: asset id ${assetId} not present (known: ${cfg.assets.map((a) => a.assetId).join(", ")})`,
    );
  }
  return asset;
}

/** Every `issue:<id>` / `redeem:<id>` direction the fetched vault currently offers, in asset order — the multi-direction dispatch `resolveSvmPoolSpec` tries (see `the consuming app SVM solver entry`). */
export function carrotAllDirections(cfg: PoolConfig): string[] {
  const c = carrotConfig(cfg);
  const dirs: string[] = [];
  for (const a of c.assets) {
    dirs.push(`issue:${a.assetId}`);
    dirs.push(`redeem:${a.assetId}`);
  }
  return dirs;
}

function decodeOraclePriceOffset(data: Uint8Array, pool: Address, oracle: Address): number {
  if (data.length < ORACLE_VERIFICATION_TAG_OFFSET + 1) {
    throw new Error(
      `carrot vault ${pool}: oracle ${oracle} account too small to carry a verification tag`,
    );
  }
  const tag = data[ORACLE_VERIFICATION_TAG_OFFSET]!;
  if (tag === ORACLE_VERIFICATION_FULL_TAG)
    return ORACLE_VERIFICATION_TAG_OFFSET + 1 + ORACLE_FEED_ID_SIZE;
  if (tag === ORACLE_VERIFICATION_PARTIAL_TAG)
    return ORACLE_VERIFICATION_TAG_OFFSET + 2 + ORACLE_FEED_ID_SIZE;
  throw new Error(
    `carrot vault ${pool}: oracle ${oracle} has an unrecognized verification-level tag ${tag}`,
  );
}

// TODO(t22-fee-netting): the Token-2022 legs (CRT shares + pyUSD, see
// CARROT_TOKEN_2022_MINTS) are NOT transfer-fee-netted in the NAV formula. This
// is safe today: pyUSD's transfer fee is 0 bps (it carries only PermanentDelegate
// / ConfidentialTransfer advisories, both routable), and the six real
// simulateTransaction dry-runs matched the un-netted NAV formula to ~0.04% (see
// the module header's VALIDATION note), i.e. no material CRT fee either. There is
// also no referenceQuote in this fetch-only adapter to net a fee on — the NAV
// fragment runs in the consuming app. If a basket/shares mint ever gains a
// nonzero effective transfer fee, net it there (net(x, feeOfInputMint) into the
// pool, net(grossOut, feeOfOutputMint) to the user) rather than here — a missed
// netting is a safe self-limit; a wrong one would silently mis-quote.
async function fetchCarrotPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<CarrotPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`carrot vault ${pool} account not found`);
  if (data.length < ASSET_FIRST_OFFSET)
    throw new Error(
      `carrot vault ${pool} account is only ${data.length} bytes — too small to be a Vault`,
    );

  const sharesMint = pubkeyAt(data, OFF_SHARES);
  const redemptionFeeBps = readUintLE(data, OFF_FEE_REDEMPTION_BPS, 2);
  const paused = data[OFF_PAUSED]! !== 0;
  if (paused) throw new Error(`carrot vault ${pool} is paused`);

  const assetsLen = Number(readUintLE(data, OFF_ASSETS_LEN, 4));
  if (assetsLen === 0) throw new Error(`carrot vault ${pool} has no basket assets`);
  if (assetsLen > CARROT_MAX_ASSETS) {
    throw new Error(
      `carrot vault ${pool} carries ${assetsLen} basket assets, over the CARROT_MAX_ASSETS=${CARROT_MAX_ASSETS} this adapter is sized for — bump the constant rather than silently truncating NAV`,
    );
  }

  interface RawAsset {
    assetId: number;
    mint: Address;
    decimals: number;
    ata: Address;
    oracle: Address;
  }
  const rawAssets: RawAsset[] = [];
  let off = ASSET_FIRST_OFFSET;
  for (let i = 0; i < assetsLen; i++) {
    if (off + ASSET_STRUCT_SIZE > data.length)
      throw new Error(`carrot vault ${pool}: truncated asset entry ${i}`);
    const assetId = Number(readUintLE(data, off, 2));
    const mint = pubkeyAt(data, off + 2);
    const decimals = data[off + 34]!;
    const ata = pubkeyAt(data, off + 35);
    const oracle = pubkeyAt(data, off + 67);
    rawAssets.push({ assetId, mint, decimals, ata, oracle });
    off += ASSET_STRUCT_SIZE;
  }

  const crtMintData = await load(sharesMint);
  if (crtMintData === null)
    throw new Error(`carrot vault ${pool}: shares mint ${sharesMint} account not found`);
  if (crtMintData.length < MINT_SUPPLY_OFFSET + 8)
    throw new Error(`carrot vault ${pool}: shares mint ${sharesMint} is not a valid SPL mint`);

  // Every basket asset is read together (NAV is their joint sum) — one bad asset self-drops the
  // WHOLE vault (every direction), never just that asset (see module header's SELF-DROP SCOPE note).
  const assets: CarrotAssetSnapshot[] = [];
  const assetAccountPairs = await Promise.all(
    rawAssets.map((a) => Promise.all([load(a.ata), load(a.oracle)])),
  );
  for (let ai = 0; ai < rawAssets.length; ai++) {
    const a = rawAssets[ai]!;
    const [ataData, oracleData] = assetAccountPairs[ai]!;
    if (ataData === null)
      throw new Error(`carrot vault ${pool}: asset ${a.assetId} vault ATA ${a.ata} not found`);
    if (ataData.length < ATA_AMOUNT_OFFSET + 8)
      throw new Error(
        `carrot vault ${pool}: asset ${a.assetId} vault ATA ${a.ata} is not a valid SPL token account`,
      );
    if (oracleData === null)
      throw new Error(`carrot vault ${pool}: asset ${a.assetId} oracle ${a.oracle} not found`);

    const priceOffset = decodeOraclePriceOffset(oracleData, pool, a.oracle);
    if (oracleData.length < priceOffset + 8 + 8 + 4 + 8) {
      throw new Error(
        `carrot vault ${pool}: asset ${a.assetId} oracle ${a.oracle} is too small for a PriceUpdateV2 price message`,
      );
    }
    const rawPrice = readUintLE(oracleData, priceOffset, 8);
    // Pyth price is a signed i64; a legitimate USD-stablecoin feed is always positive — reject the
    // top-bit-set (negative) case rather than silently treating it as a huge unsigned price.
    if (rawPrice >= 1n << 63n)
      throw new Error(
        `carrot vault ${pool}: asset ${a.assetId} oracle ${a.oracle} reports a negative price`,
      );
    if (rawPrice === 0n)
      throw new Error(
        `carrot vault ${pool}: asset ${a.assetId} oracle ${a.oracle} reports a zero price`,
      );
    const publishTime = readUintLE(oracleData, priceOffset + 8 + 8 + 4, 8);

    // exponent (i32) sits AFTER price(i64, 8 bytes) AND conf(u64, 8 bytes) — offset +16, not +8.
    const rawExponent = readUintLE(oracleData, priceOffset + 8 + 8, 4);
    const exponent = Number(rawExponent >= 1n << 31n ? rawExponent - (1n << 32n) : rawExponent);
    // Range-gate the ORACLE exponent before it reaches `10n ** BigInt(scaleExp)` below. `a.decimals`
    // needs no such gate — it is one byte, so 0..=255 by construction (see oracle-exponent.ts).
    assertOracleExponent(
      "pyth-price-update-v2",
      exponent,
      `carrot vault ${pool}: asset ${a.assetId} oracle ${a.oracle}`,
    );
    const scaleExp = CARROT_TARGET_SCALE + exponent - a.decimals;
    if (scaleExp < 0) {
      throw new Error(
        `carrot vault ${pool}: asset ${a.assetId} has a negative implied scale exponent ${scaleExp} (exponent=${exponent}, decimals=${a.decimals}) — CARROT_TARGET_SCALE too small`,
      );
    }
    const scale = 10n ** BigInt(scaleExp);

    assets.push({
      assetId: a.assetId,
      mint: a.mint,
      decimals: a.decimals,
      ata: a.ata,
      oracle: a.oracle,
      priceOffset,
      scale,
      priceSnapshot: rawPrice,
      publishTime,
    });
  }

  return {
    venue: "carrot",
    pool,
    sharesMint,
    redemptionFeeBps,
    assets,
    direction: `issue:${assets[0]!.assetId}`,
  };
}

export const carrot = {
  slug: "carrot" as const,
  programId: CARROT_PROGRAM_ID,
  fetchPoolConfig: (owned: OwnedAccountLoader, pool: Address): Promise<CarrotPoolConfig> =>
    fetchCarrotPoolConfig(owned, pool),
};

/** Prepare-time direction gate: self-drops the SPECIFIC direction (not the whole vault) if its asset's oracle reading is stale. */
export function carrotGate(base: PoolConfig, now: bigint): void {
  const c = carrotConfig(base);
  const { assetId } = parseCarrotDirection(c.direction);
  const asset = requireAsset(c, assetId);
  if (now - asset.publishTime > MAX_ORACLE_STALENESS_SECONDS) {
    throw new Error(
      `carrot vault ${c.pool}: asset ${assetId}'s oracle ${asset.oracle} is stale (publishTime ${asset.publishTime}, now ${now}, over ${MAX_ORACLE_STALENESS_SECONDS}s)`,
    );
  }
}

export function carrotMints(base: PoolConfig): { inMint: Address; outMint: Address } {
  const c = carrotConfig(base);
  const { op, assetId } = parseCarrotDirection(c.direction);
  const asset = requireAsset(c, assetId);
  return op === "issue"
    ? { inMint: asset.mint, outMint: c.sharesMint }
    : { inMint: c.sharesMint, outMint: asset.mint };
}

export function carrotApplyDirection(
  base: PoolConfig,
  direction: string | undefined,
): CarrotPoolConfig {
  const c = carrotConfig(base);
  if (direction === undefined) return c;
  parseCarrotDirection(direction); // validates shape; requireAsset (via mints/gate) validates existence
  return { ...c, direction };
}

// PYTH_RECEIVER_PROGRAM_ID / U64_MAX are documented constants for readers of this module (fetch-time
// gates cite the program id; the redeem helper's shared U64_MAX-style sentinel convention is noted
// for parity with obric-v2 even though this family's issue side needs no explicit uncapped sentinel).
export { PYTH_RECEIVER_PROGRAM_ID, U64_MAX as CARROT_U64_MAX };
