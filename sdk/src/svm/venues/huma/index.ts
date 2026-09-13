/**
 * Huma Finance ("permissionless" program) venue adapter — a tranche
 * deposit/instant-withdraw vault, NOT a constant-product pool. A lender
 * `deposit()`s the pool's underlying asset (currently USDC) and receives
 * mode-tranche shares (an SPL mint — "Classic"/"PST" or "Maxi"/"mPST" on the
 * live Genesis pool) at the mode's live share price; `instant_withdraw()`
 * reverses that at the same price, minus a liquidity-utilization-tiered fee,
 * bypassing the async redemption queue. Modeled here as a two-instruction
 * bidirectional swap between the underlying mint and a mode's share mint —
 * `deposit` for underlying->share, `instant_withdraw` for share->underlying.
 *
 * QUOTE MATH (exact linear, no curve):
 *   deposit:  shares = floor(assetsIn * modeSupply / modeAssets)   (1:1 if either side is 0)
 *   withdraw: grossAssets = floor(sharesIn * modeAssets / modeSupply)
 *             netAssets   = grossAssets - floor(grossAssets * feeBps / 10000)
 * `modeAssets` (ModeState.assets, u128) and `modeSupply` (the mode mint's SPL
 * supply) are both LIVE reads — they change on every trade/yield-refresh —
 * baked at nothing but their byte OFFSET (computed once at fetchPoolConfig
 * time from the fetched account's actual shape; a mode added/removed
 * between prepare and cook is the same drift class every adapter here
 * accepts, and a real mismatch fails the venue CPI loudly rather than
 * quietly, per the self-drop philosophy).
 *
 * FEE MODEL (PoolConfig.instant_withdrawal_config, baked — governance-set,
 * not per-trade-mutable): a STEP function of the pool's CURRENT liquid-asset
 * ratio, `PoolState doc: "liquid_assets_deployed - ... used for instant
 * withdrawal fee computation"` — i.e. assets parked in OTHER liquid DeFi
 * protocols count as available liquidity for this ratio, not just the idle
 * `pool_underlying_token` balance. Measured live on the mainnet Genesis pool
 * (2026-07-31): idle balance ~844k USDC / total pool assets ~218.18M USDC is
 * only 38 bps alone (would hit the worst 10000bps/100% tier and make
 * instant_withdraw useless), but idle+deployed ~20.1M USDC / total is 921
 * bps, landing the real fee at 100 bps (the 800-1000 bucket) — a plausible,
 * intentional instant-withdrawal fee, which is the basis for reading
 * `liquid_assets_deployed` INTO the ratio's numerator, not out of it. The
 * on-chain program's own exact formula is closed-source (no public Rust for
 * the `permissionless` program was found — see docs/svm-venues.md); this is
 * a reverse-engineered model, not a transcription, exactly like obric-v2's
 * oracle-scaling caveat. `feeTiers` is read ascending by threshold and the
 * FIRST (smallest) matching threshold applies — reproduces the observed
 * on-chain schedule (500/10000, 600/180, 800/150, 1000/100, 1200/75,
 * 1500/30, 2000/20, 10000/5 bps) exactly as a monotone step function.
 *
 * CAPS (the ladder cap + self-drop, per the venue plan): `instant_withdrawal
 * _reserve_limit` (PoolConfig.instant_withdrawal_config, baked) hard-caps a
 * single instant_withdraw's NET asset output; `lp_config.liquidity_cap`
 * minus the mode's current total assets caps how much MORE can be deposited.
 * Both are enforced as an input-side clamp (the curve goes flat, not
 * negative, past the cap) so the emitted quote stays monotone and concave
 * over the whole domain, never a cliff to zero mid-ladder.
 *
 * LENDER_STATE PRECONDITION (disclosed, not hidden): `instant_withdraw`
 * requires a `LenderState` PDA that must already exist for the CPI's signer
 * (created once via `create_lender_accounts_v2`, the same one-time-bootstrap
 * shape as an ATA — see `humaLenderStatePda`/`humaCreateLenderAccountsIx`
 * below). This adapter emits an UNRESOLVED `lender-state`/`lender-mode-ata`-
 * style ref for it (see ladder.ts) — exactly the shape pumpswap's BUY path
 * already uses for its owner-derived `user_volume_accumulator` PDA — because
 * the address depends on the RUNTIME owner identity, which prepare time does
 * not know (the recipe stays identity-free). The caller resolving accounts
 * for a Huma-withdraw-carrying cook must supply that ref (and must have run
 * `create_lender_accounts_v2` once for that owner+mode beforehand); a cook
 * against an owner with no LenderState reverts atomically on this CPI alone
 * (venue-robustness: nothing else in the cook is affected).
 *
 * Byte offsets verified against the IDL in `@huma-finance/permissionless-sdk`
 * (npm, `dist/idl/permissionless.json`, address matches
 * `HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn` exactly) and a real mainnet
 * account dump of the Genesis pool (poolConfig
 * `28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS`, two independent fetches
 * five minutes apart cross-checked field-for-field against an
 * Anchor-BorshAccountsCoder decode of the same IDL).
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
import { address, getAddressCodec, getAddressEncoder, getUtf8Encoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type {
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "huma";

export const HUMA_PROGRAM_ID = address("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Anchor discriminators: sha256(`global:<ix_name>`)[0..8] — taken verbatim
// from the published IDL, not recomputed (no local sha256 dependency here).
const DEPOSIT_DISCRIMINATOR = Uint8Array.from([242, 35, 198, 137, 82, 225, 242, 182]);
const INSTANT_WITHDRAW_DISCRIMINATOR = Uint8Array.from([171, 49, 145, 176, 48, 101, 112, 162]);

// deposit()'s pass-through commitment args — this adapter never opts into a
// Huma commitment period (matches the official SDK client's NO_COMMIT
// default, `DepositCommitment.NO_COMMITMENT`).
const DEPOSIT_COMMITMENT = "NO_COMMITMENT";
const DEPOSIT_COMMITMENT_AUTO_RENEWAL = false;

// instant_withdraw()'s own slippage guard is venue-level, like every other
// adapter's minOut=1 here — the recipe's terminal outAta-delta check is the
// real floor, so this stays maximally permissive (10000 bps = 100%) to avoid
// a spurious self-revert on stale off-chain fee-tier drift.
const MAX_FEE_BPS_PERMISSIVE = 10000;

const U64_MAX = (1n << 64n) - 1n;

// Curated instrument table: Huma has exactly one deployed pool + two modes on
// mainnet (there is no single on-chain account carrying both the underlying
// mint AND a mode's share mint together, so this venue cannot be discovered
// via a generic getProgramAccounts memcmp scan — see
// the consuming app SVM discovery module's SVM_FAMILY_FILTERS doc for why it is deliberately
// NOT in that table). Keyed by ModeConfig account address (base58) -> the
// pool's PoolConfig account; everything else (PoolState, ModeMint,
// PoolAuthority, PoolUnderlyingToken, ...) is PDA-derived or read live off
// PoolConfig, never separately hardcoded.
export const HUMA_CURATED_MODE_CONFIGS: Readonly<Record<string, Address>> = {
  // Classic mode ("PST"), Huma 2.0 Genesis pool (USDC).
  "3FhoMDyKzQqxtGxnz9DfysfoGQKvgDnSFjoDGgguDCQN": address(
    "28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS",
  ),
  // Maxi mode ("mPST"), same Genesis pool.
  AcHvC47rpoMAY22CbHRpp7vsAskRyhyZGYQCqdm4BWcH: address(
    "28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS",
  ),
};

export interface HumaFeeTier {
  /** Liquid-asset-ratio bps threshold: this tier applies when the ratio is BELOW it. */
  ltBps: bigint;
  feeBps: bigint;
}

export interface HumaPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'deposit' (underlying -> mode share) | 'withdraw' (mode share -> underlying). */
  direction: "deposit" | "withdraw";
  /** = cfg.pool: the ModeConfig account address (uniquely identifies this tradeable instrument). */
  modeConfig: Address;
  poolConfigAccount: Address;
  poolState: Address;
  modeMint: Address;
  poolAuthority: Address;
  poolUnderlyingToken: Address;
  underlyingMint: Address;
  humaConfig: Address;
  poolOwnerTreasuryUnderlyingToken: Address;
  /** Byte offset of this mode's ModeState.assets (u128) within the fetched PoolState account. */
  modeAssetsOffset: number;
  /** Byte offset of PoolState.liquid_assets_deployed (u64) — pool-wide, mode-index-independent. */
  liquidAssetsDeployedOffset: number;
  /** Byte offset of PoolState.disbursement_reserve (u128) — always fixed (before any Vec). */
  disbursementReserveOffset: number;
  /** LPConfig.liquidity_cap (u128, baked) — deposit-side cap. */
  liquidityCap: bigint;
  /** LPConfig.min_deposit_amount (u64, baked) — deposit dust floor. */
  minDepositAmount: bigint;
  /** InstantWithdrawalConfig.instant_withdrawal_reserve_limit (u64, baked) — withdraw-side cap. */
  reserveLimit: bigint;
  /** InstantWithdrawalConfig.instant_withdrawal_fee_configs, ascending by ltBps (baked). */
  feeTiers: readonly HumaFeeTier[];
  /** InstantWithdrawalConfig.liquidity_source (Option<Pubkey>, baked), if the pool has one configured. */
  liquidityDeploymentConfig: Address | null;
  /** PDA(["deployment_state", liquidityDeploymentConfig]), present iff liquidityDeploymentConfig is. */
  liquidityDeploymentState: Address | null;
}

function asConfig(cfg: PoolConfig): HumaPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  return cfg as HumaPoolConfig;
}

const poolRef = (cfg: HumaPoolConfig): string => `${SLUG}:${cfg.modeConfig}`;

async function derivePda(
  programAddress: Address,
  seeds: readonly (Uint8Array | Address)[],
): Promise<Address> {
  const encoder = getAddressEncoder();
  const rawSeeds = seeds.map((s) => (typeof s === "string" ? encoder.encode(s as Address) : s));
  return memoizedGetProgramDerivedAddress(programAddress, rawSeeds as Uint8Array[]);
}

/** Canonical ATA(owner, mint) under the classic SPL Token program. */
async function findAta(owner: Address, mint: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return derivePda(ASSOCIATED_TOKEN_PROGRAM, [
    encoder.encode(owner) as Uint8Array,
    encoder.encode(TOKEN_PROGRAM) as Uint8Array,
    encoder.encode(mint) as Uint8Array,
  ]);
}

const utf8 = getUtf8Encoder();

/** PDA(["lender_state", modeConfig, lender], HUMA_PROGRAM_ID) — a per-(mode,owner) precondition account; see the module doc. */
export async function humaLenderStatePda(modeConfig: Address, lender: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return derivePda(HUMA_PROGRAM_ID, [
    utf8.encode("lender_state") as Uint8Array,
    encoder.encode(modeConfig) as Uint8Array,
    encoder.encode(lender) as Uint8Array,
  ]);
}

// ── byte decoding (dynamic Vec/String layouts — see the module doc for the offset derivation) ──

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

const MODE_STATE_SIZE = 216; // assets(16)+losses(16)+cumulative_yields(16)+assets_refreshed_at(8)+padding(160)
const REDEMPTION_SIZE = 376; // next_request_id(16)+last_request_id(16)+2*RedemptionGating(104)+padding(136)
const POOL_STATS_SIZE = 192; // cumulative_amount_deployed(16)+cumulative_amount_paid_back(16)+padding(160)
const FEE_CONFIG_SIZE = 164; // liquid_asset_ratio_lt_bps(2)+fee_bps(2)+reserved(160)
const LP_CONFIG_SIZE = 208; // liquidity_cap(16)+min_deposit_amount(8)+min_redemption_shares(8)+2*u128(32)+padding(144)

interface DecodedPoolState {
  status: number;
  modeIndex: number;
  modeAssetsOffset: number;
  liquidAssetsDeployedOffset: number;
  disbursementReserveOffset: number;
}

/** Decode just the fields this adapter needs from a fetched PoolState account, for a given mode's ModeConfig address. */
function decodePoolState(data: Uint8Array, modeConfig: Address): DecodedPoolState {
  const base = 8; // discriminator
  const status = data[base + 1];
  const disbursementReserveOffset = base + 2;
  const modeStatesFirstOffset = base + 22; // bump(1)+status(1)+disbursement_reserve(16)+vec-len(4)
  const modeCount = Number(readUintLE(data, base + 18, 4));
  const modeConfigKeysLenOffset = modeStatesFirstOffset + modeCount * MODE_STATE_SIZE;
  const modeConfigKeysFirstOffset = modeConfigKeysLenOffset + 4;

  let modeIndex = -1;
  for (let i = 0; i < modeCount; i++) {
    if (pubkeyAt(data, modeConfigKeysFirstOffset + i * 32) === modeConfig) {
      modeIndex = i;
      break;
    }
  }
  if (modeIndex === -1) {
    throw new Error(
      `${SLUG} PoolState does not list mode_config ${modeConfig} in mode_config_keys`,
    );
  }

  const afterModeConfigKeys = modeConfigKeysFirstOffset + modeCount * 32;
  const afterRedemption = afterModeConfigKeys + REDEMPTION_SIZE;
  const liquidAssetsDeployedOffset = afterRedemption + POOL_STATS_SIZE;

  return {
    status,
    modeIndex,
    modeAssetsOffset: modeStatesFirstOffset + modeIndex * MODE_STATE_SIZE,
    liquidAssetsDeployedOffset,
    disbursementReserveOffset,
  };
}

interface DecodedPoolConfig {
  humaConfig: Address;
  poolOwnerTreasury: Address;
  underlyingMint: Address;
  liquidityCap: bigint;
  minDepositAmount: bigint;
  reserveLimit: bigint;
  feeTiers: HumaFeeTier[];
  liquiditySource: Address | null;
}

function decodePoolConfig(data: Uint8Array): DecodedPoolConfig {
  const base = 8; // discriminator
  const humaConfig = pubkeyAt(data, base + 1);
  const poolOwnerTreasury = pubkeyAt(data, base + 65);
  const underlyingMint = pubkeyAt(data, base + 97);
  const poolNameLenOffset = base + 162;
  const poolNameLen = Number(readUintLE(data, poolNameLenOffset, 4));
  const lpConfigOffset = poolNameLenOffset + 4 + poolNameLen;

  const liquidityCap = readUintLE(data, lpConfigOffset, 16);
  const minDepositAmount = readUintLE(data, lpConfigOffset + 16, 8);

  const iwcOffset = lpConfigOffset + LP_CONFIG_SIZE;
  const reserveLimit = readUintLE(data, iwcOffset, 8);
  const feeConfigsLenOffset = iwcOffset + 8;
  const feeConfigsFirstOffset = feeConfigsLenOffset + 4;
  const feeCount = Number(readUintLE(data, feeConfigsLenOffset, 4));

  const feeTiers: HumaFeeTier[] = [];
  for (let i = 0; i < feeCount; i++) {
    const off = feeConfigsFirstOffset + i * FEE_CONFIG_SIZE;
    feeTiers.push({ ltBps: readUintLE(data, off, 2), feeBps: readUintLE(data, off + 2, 2) });
  }
  feeTiers.sort((a, b) => (a.ltBps < b.ltBps ? -1 : a.ltBps > b.ltBps ? 1 : 0));

  const liquiditySourceOffset = feeConfigsFirstOffset + feeCount * FEE_CONFIG_SIZE;
  const liquiditySourceTag = data[liquiditySourceOffset];
  const liquiditySource =
    liquiditySourceTag === 1 ? pubkeyAt(data, liquiditySourceOffset + 1) : null;

  return {
    humaConfig,
    poolOwnerTreasury,
    underlyingMint,
    liquidityCap,
    minDepositAmount,
    reserveLimit,
    feeTiers,
    liquiditySource,
  };
}

/** The tier fee (bps) applying at a given liquid-asset-ratio (bps): the first (smallest threshold) tier the ratio is strictly below; 0 if none match. */
export function humaFeeBpsFor(liquidRatioBps: bigint, feeTiers: readonly HumaFeeTier[]): bigint {
  for (const tier of feeTiers) {
    if (liquidRatioBps < tier.ltBps) return tier.feeBps;
  }
  return 0n;
}

export const huma: SvmVenueAdapter = {
  slug: SLUG,
  kind: "constant-product", // no curve concept fits better; gates only rung defaults/helper inclusion (see types.ts).
  programId: HUMA_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<HumaPoolConfig> {
    const modeConfig = pool;
    const poolConfigAccount = HUMA_CURATED_MODE_CONFIGS[modeConfig as string];
    if (poolConfigAccount === undefined) {
      throw new Error(
        `${SLUG} unknown mode_config ${modeConfig} — not in the curated instrument table`,
      );
    }

    const poolConfigData = await load(poolConfigAccount);
    if (poolConfigData === null)
      throw new Error(`${SLUG} pool_config account ${poolConfigAccount} not found`);
    const decodedConfig = decodePoolConfig(poolConfigData);

    const poolState = await derivePda(HUMA_PROGRAM_ID, [
      utf8.encode("pool_state") as Uint8Array,
      getAddressEncoder().encode(poolConfigAccount) as Uint8Array,
    ]);
    const poolStateData = await load(poolState);
    if (poolStateData === null)
      throw new Error(`${SLUG} pool_state account ${poolState} not found`);
    const decodedState = decodePoolState(poolStateData, modeConfig);

    const poolAuthority = await derivePda(HUMA_PROGRAM_ID, [
      utf8.encode("pool_authority") as Uint8Array,
      getAddressEncoder().encode(poolConfigAccount) as Uint8Array,
    ]);
    const modeMint = await derivePda(HUMA_PROGRAM_ID, [
      utf8.encode("mode_mint") as Uint8Array,
      getAddressEncoder().encode(poolConfigAccount) as Uint8Array,
      getAddressEncoder().encode(modeConfig) as Uint8Array,
    ]);
    const modeMintData = await load(modeMint);
    if (modeMintData === null) throw new Error(`${SLUG} mode_mint account ${modeMint} not found`);

    // The deposit/instant_withdraw ix moves both the underlying mint and the
    // mode share mint through legacy-SPL (Tokenkeg) transfers only, so a
    // Token-2022 mint (or one carrying an un-routable extension) on either side
    // must SELF-DROP the pool rather than be silently assumed legacy. The thrown
    // error IS the graceful-drop signal (the SvmRoute orchestrator catches it
    // and drops the venue). The mode-mint bytes are reused; the underlying mint
    // is loaded on demand and, if unreadable, falls back to the legacy
    // assumption, keeping the classic 82-byte path byte-identical.
    const _mintEntries = [
      [decodedConfig.underlyingMint, null],
      [modeMint, modeMintData],
    ] as const;
    const _mintDatas = await Promise.all(
      _mintEntries.map(([mint, preloaded]) => preloaded ?? load(mint)),
    );
    for (let _i = 0; _i < _mintEntries.length; _i++) {
      const mint = _mintEntries[_i]![0];
      const mintData = _mintDatas[_i]!;
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${modeConfig} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${modeConfig} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }

    const poolUnderlyingToken = await findAta(poolAuthority, decodedConfig.underlyingMint);
    const poolUnderlyingTokenData = await load(poolUnderlyingToken);
    if (poolUnderlyingTokenData === null)
      throw new Error(`${SLUG} pool_underlying_token account ${poolUnderlyingToken} not found`);

    const poolOwnerTreasuryUnderlyingToken = await findAta(
      decodedConfig.poolOwnerTreasury,
      decodedConfig.underlyingMint,
    );

    const liquidityDeploymentState =
      decodedConfig.liquiditySource !== null
        ? await derivePda(HUMA_PROGRAM_ID, [
            utf8.encode("deployment_state") as Uint8Array,
            getAddressEncoder().encode(decodedConfig.liquiditySource) as Uint8Array,
          ])
        : null;

    return {
      venue: SLUG,
      pool: modeConfig,
      direction: "deposit",
      modeConfig,
      poolConfigAccount,
      poolState,
      modeMint,
      poolAuthority,
      poolUnderlyingToken,
      underlyingMint: decodedConfig.underlyingMint,
      humaConfig: decodedConfig.humaConfig,
      poolOwnerTreasuryUnderlyingToken,
      modeAssetsOffset: decodedState.modeAssetsOffset,
      liquidAssetsDeployedOffset: decodedState.liquidAssetsDeployedOffset,
      disbursementReserveOffset: decodedState.disbursementReserveOffset,
      liquidityCap: decodedConfig.liquidityCap,
      minDepositAmount: decodedConfig.minDepositAmount,
      reserveLimit: decodedConfig.reserveLimit,
      feeTiers: decodedConfig.feeTiers,
      liquidityDeploymentConfig: decodedConfig.liquiditySource,
      liquidityDeploymentState,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = asConfig(cfg);
    return [
      { ref: `${poolRef(c)}:pool-state`, address: c.poolState },
      { ref: `${poolRef(c)}:mode-mint`, address: c.modeMint },
      { ref: `${poolRef(c)}:pool-underlying`, address: c.poolUnderlyingToken },
    ];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = asConfig(cfg);
    if (amountIn <= 0n) throw new Error(`${SLUG} amountIn must be positive, got ${amountIn}`);
    if (amountIn > U64_MAX) throw new Error(`${SLUG} amountIn must fit u64, got ${amountIn}`);

    // Account model (RS/svm target): reads go through main()'s ordered `acc<k>`
    // params (k = the ref's index in quoteAccounts) — [pool-state=acc0,
    // mode-mint=acc1, pool-underlying=acc2] — not `accountUint("<ref>", …)`.
    // `accountUint` lowered to CAST_LE, so `.toLe()` is the exact endianness match.
    const poolState = "acc0";
    const modeMint = "acc1";
    const poolUnderlying = "acc2";

    // NO ternaries: the compiler requires a ternary to be the WHOLE (unnested)
    // right-hand side of an assignment, so every branch here is a plain
    // top-level `if (cond) { assign }` — the same idiom every other stateful
    // adapter in this repo uses (see e.g. goonfi-v2/ladder.ts's emitSetup).
    if (c.direction === "deposit") {
      return [
        `const humaAssets${i} = svm.sload(${poolState}, ${c.modeAssetsOffset}, 16).toLe();`,
        `const humaSupply${i} = svm.sload(${modeMint}, 36, 8).toLe();`,
        `let humaRoom${i} = 0;`,
        `if (${c.liquidityCap} > humaAssets${i}) { humaRoom${i} = ${c.liquidityCap} - humaAssets${i} }`,
        `let humaIn${i} = ${amountIn};`,
        `if (humaIn${i} > humaRoom${i}) { humaIn${i} = humaRoom${i} }`,
        `let q${i} = 0;`,
        `if (humaIn${i} >= ${c.minDepositAmount}) {`,
        `  q${i} = humaIn${i};`,
        `  if (humaSupply${i} !== 0) {`,
        `    if (humaAssets${i} !== 0) {`,
        `      q${i} = humaIn${i} * humaSupply${i} / humaAssets${i};`,
        `    }`,
        `  }`,
        `}`,
      ].join("\n");
    }

    return [
      `const humaAssets${i} = svm.sload(${poolState}, ${c.modeAssetsOffset}, 16).toLe();`,
      `const humaSupply${i} = svm.sload(${modeMint}, 36, 8).toLe();`,
      `const humaLiquid${i} = svm.sload(${poolUnderlying}, 64, 8).toLe();`,
      `const humaDeployed${i} = svm.sload(${poolState}, ${c.liquidAssetsDeployedOffset}, 8).toLe();`,
      `const humaDisbursed${i} = svm.sload(${poolState}, ${c.disbursementReserveOffset}, 16).toLe();`,
      `const humaAvailRaw${i} = humaLiquid${i} + humaDeployed${i};`,
      `let humaAvail${i} = 0;`,
      `if (humaAvailRaw${i} > humaDisbursed${i}) { humaAvail${i} = humaAvailRaw${i} - humaDisbursed${i} }`,
      `let humaRatio${i} = 10000;`,
      `if (humaAssets${i} !== 0) { humaRatio${i} = humaAvail${i} * 10000 / humaAssets${i} }`,
      ...humaFeeAssignLines(c, `humaRatio${i}`, `humaFee${i}`),
      `let q${i} = 0;`,
      `if (humaSupply${i} !== 0) {`,
      `  const humaGross${i} = ${amountIn} * humaAssets${i} / humaSupply${i};`,
      `  q${i} = humaGross${i} - humaGross${i} * humaFee${i} / 10000;`,
      `  if (q${i} > ${c.reserveLimit}) { q${i} = ${c.reserveLimit} }`,
      `}`,
    ].join("\n");
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = asConfig(cfg);
    if (amountIn <= 0n) throw new Error(`${SLUG} amountIn must be positive, got ${amountIn}`);
    if (amountIn > U64_MAX) throw new Error(`${SLUG} amountIn must fit u64, got ${amountIn}`);

    if (c.direction === "deposit") {
      const data = encodeDepositData(amountIn);
      return { programId: HUMA_PROGRAM_ID, data, accounts: depositAccounts(c, user) };
    }
    const data = encodeInstantWithdrawData(amountIn);
    return { programId: HUMA_PROGRAM_ID, data, accounts: instantWithdrawAccounts(c, user) };
  },

  referenceQuote(cfg: PoolConfig, state: Record<string, Uint8Array>, amountIn: bigint): bigint {
    const c = asConfig(cfg);
    if (amountIn <= 0n) throw new Error(`${SLUG} amountIn must be positive, got ${amountIn}`);

    const poolState = state[c.poolState];
    const modeMintData = state[c.modeMint];
    const poolUnderlyingData = state[c.poolUnderlyingToken];
    if (poolState === undefined)
      throw new Error(`${SLUG} referenceQuote state is missing pool_state ${c.poolState}`);
    if (modeMintData === undefined)
      throw new Error(`${SLUG} referenceQuote state is missing mode_mint ${c.modeMint}`);
    if (poolUnderlyingData === undefined)
      throw new Error(
        `${SLUG} referenceQuote state is missing pool_underlying_token ${c.poolUnderlyingToken}`,
      );

    if (poolState[9] !== 1)
      throw new Error(
        `${SLUG} pool ${c.poolConfigAccount} is not On (status byte ${poolState[9]})`,
      );

    const modeAssets = readUintLE(poolState, c.modeAssetsOffset, 16);
    const modeSupply = readUintLE(modeMintData, 36, 8);

    if (c.direction === "deposit") {
      const room = c.liquidityCap > modeAssets ? c.liquidityCap - modeAssets : 0n;
      const effIn = amountIn < room ? amountIn : room;
      if (effIn < c.minDepositAmount) return 0n;
      return modeSupply === 0n || modeAssets === 0n ? effIn : (effIn * modeSupply) / modeAssets;
    }

    if (modeSupply === 0n) return 0n;
    const liquid = readUintLE(poolUnderlyingData, 64, 8);
    const deployed = readUintLE(poolState, c.liquidAssetsDeployedOffset, 8);
    const disbursed = readUintLE(poolState, c.disbursementReserveOffset, 16);
    const availRaw = liquid + deployed;
    const avail = availRaw > disbursed ? availRaw - disbursed : 0n;
    const ratioBps = modeAssets === 0n ? 10000n : (avail * 10000n) / modeAssets;
    const feeBps = humaFeeBpsFor(ratioBps, c.feeTiers);
    const gross = (amountIn * modeAssets) / modeSupply;
    const net = gross - (gross * feeBps) / 10000n;
    return net < c.reserveLimit ? net : c.reserveLimit;
  },
};

/**
 * Builds the tiered instant-withdrawal fee lookup as a flat `let` + sequence
 * of top-level `if` reassignments — NO ternaries (the compiler rejects a
 * nested/chained ConditionalExpression; see this file's emitQuote doc).
 * Tiers are ascending by ltBps; checked in DESCENDING order so the LAST if to
 * fire (the smallest matching threshold — the correct, most-conservative
 * tier) is the one left standing, reproducing "first ascending match wins"
 * exactly.
 */
export function humaFeeAssignLines(c: HumaPoolConfig, ratioVar: string, feeVar: string): string[] {
  const lines = [`let ${feeVar} = 0;`];
  for (let i = c.feeTiers.length - 1; i >= 0; i--) {
    const tier = c.feeTiers[i];
    lines.push(`if (${ratioVar} < ${tier.ltBps}) { ${feeVar} = ${tier.feeBps} }`);
  }
  return lines;
}

function encodeDepositData(assets: bigint): Uint8Array {
  const commitmentBytes = new TextEncoder().encode(DEPOSIT_COMMITMENT);
  const data = new Uint8Array(8 + 8 + 4 + commitmentBytes.length + 1);
  data.set(DEPOSIT_DISCRIMINATOR, 0);
  new DataView(data.buffer).setBigUint64(8, assets, true);
  new DataView(data.buffer).setUint32(16, commitmentBytes.length, true);
  data.set(commitmentBytes, 20);
  data[20 + commitmentBytes.length] = DEPOSIT_COMMITMENT_AUTO_RENEWAL ? 1 : 0;
  return data;
}

function encodeInstantWithdrawData(shares: bigint): Uint8Array {
  const data = new Uint8Array(8 + 8 + 2);
  data.set(INSTANT_WITHDRAW_DISCRIMINATOR, 0);
  new DataView(data.buffer).setBigUint64(8, shares, true);
  new DataView(data.buffer).setUint16(16, MAX_FEE_BPS_PERMISSIVE, true);
  return data;
}

function depositAccounts(c: HumaPoolConfig, user: SwapUser): VenueAccount[] {
  return [
    { ref: user.owner, signer: true },
    { ref: `${poolRef(c)}:huma-config`, address: c.humaConfig },
    { ref: `${poolRef(c)}:pool-config`, address: c.poolConfigAccount },
    { ref: `${poolRef(c)}:pool-state`, address: c.poolState, writable: true },
    { ref: `${poolRef(c)}:mode-config`, address: c.modeConfig },
    { ref: `${poolRef(c)}:mode-mint`, address: c.modeMint, writable: true },
    { ref: `${poolRef(c)}:pool-authority`, address: c.poolAuthority },
    { ref: `${poolRef(c)}:underlying-mint`, address: c.underlyingMint },
    { ref: `${poolRef(c)}:pool-underlying`, address: c.poolUnderlyingToken, writable: true },
    { ref: user.inAta, writable: true },
    { ref: user.outAta, writable: true },
    { ref: `${poolRef(c)}:underlying-token-program`, address: TOKEN_PROGRAM },
    { ref: `${poolRef(c)}:mode-token-program`, address: TOKEN_PROGRAM },
  ];
}

function instantWithdrawAccounts(c: HumaPoolConfig, user: SwapUser): VenueAccount[] {
  const deploymentConfig = c.liquidityDeploymentConfig ?? HUMA_PROGRAM_ID;
  const deploymentState = c.liquidityDeploymentState ?? HUMA_PROGRAM_ID;
  return [
    { ref: user.owner, signer: true },
    { ref: `${poolRef(c)}:huma-config`, address: c.humaConfig },
    { ref: `${poolRef(c)}:pool-config`, address: c.poolConfigAccount },
    { ref: `${poolRef(c)}:pool-state`, address: c.poolState, writable: true },
    { ref: `${poolRef(c)}:mode-config`, address: c.modeConfig },
    { ref: `${poolRef(c)}:mode-mint`, address: c.modeMint, writable: true },
    { ref: `${poolRef(c)}:deployment-config`, address: deploymentConfig },
    { ref: `${poolRef(c)}:deployment-state`, address: deploymentState, writable: true },
    // Runtime-owner-dependent PDA (see humaLenderStatePda) — the caller's
    // resolveAccounts resolution map MUST supply this ref (no baked address),
    // exactly like pumpswap's owner-derived user_volume_accumulator.
    { ref: `${poolRef(c)}:lender-state`, writable: true },
    { ref: `${poolRef(c)}:underlying-mint`, address: c.underlyingMint },
    { ref: `${poolRef(c)}:pool-authority`, address: c.poolAuthority, writable: true },
    { ref: `${poolRef(c)}:pool-underlying`, address: c.poolUnderlyingToken, writable: true },
    { ref: user.outAta, writable: true },
    {
      ref: `${poolRef(c)}:treasury-underlying`,
      address: c.poolOwnerTreasuryUnderlyingToken,
      writable: true,
    },
    { ref: user.inAta, writable: true },
    { ref: `${poolRef(c)}:underlying-token-program`, address: TOKEN_PROGRAM },
    { ref: `${poolRef(c)}:mode-token-program`, address: TOKEN_PROGRAM },
  ];
}

export {
  depositAccounts as humaDepositAccounts,
  instantWithdrawAccounts as humaInstantWithdrawAccounts,
};
export {
  encodeDepositData as humaEncodeDepositData,
  encodeInstantWithdrawData as humaEncodeInstantWithdrawData,
};
export { MODE_STATE_SIZE as HUMA_MODE_STATE_SIZE };
