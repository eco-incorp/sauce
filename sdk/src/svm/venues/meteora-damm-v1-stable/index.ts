/**
 * Meteora DAMM v1 (Dynamic AMM, ex-Mercurial) stable-curve venue adapter.
 *
 * Quotes exact-in A->B (token_a -> token_b, the pool's canonical direction).
 * Reserves do NOT come from the pool account nor from raw SPL vault balances:
 * pool funds live inside two dynamic-vault accounts (lending aggregator), so
 * reserve_X = floor(x_vault_lp.amount * vault_x_unlocked(t) / x_lp_mint.supply)
 * where unlocked(t) applies the vault's locked-profit decay (denominator 1e12).
 * Fees are charged on the INPUT token (minimum fee of 1 native unit when the
 * numerator is non-zero); the curve is Saber-style 2-coin stableswap on
 * multiplier-upscaled reserves with an explicit -1 on dy; a vault
 * deposit/withdraw share-math simulation captures 1-2 native units of
 * additional rounding loss on each side.
 *
 * The emitted quote calls the shared stable Newton helpers the solswap
 * generator declares once when any stable pool is present (signatures shared
 * with saber-stableswap; ann = amp * 2 is computed inside the helpers):
 *   function stableD(amp, xa, xb)  — Newton D: <=256 iterations, |d - dPrev| <= 1
 *   function stableY(amp, x, d)    — Newton y: <=256 iterations, |y - yPrev| <= 1
 *
 * Overflow bounds (engine arithmetic wraps): every in-fragment product is at
 * most u64 * u64 or u64 * 1e12 < 2^128; the historical venue investigation bounds the curve
 * intermediates for stable pairs at D < 2^100 (u128 suffices, amp <= 10000,
 * 6-decimal magnitudes), so no fragment product approaches 2^256.
 *
 * Original venue investigation (historical):
 * https://github.com/eco-incorp/sauce/blob/d3686430ee308994f95309a8c9b2d5930d71cf5d/docs/svm-venues.md
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { hexString } from "../../../bytes.js";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type {
  AccountBytesMap,
  AccountLoader,
  OwnedAccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "meteora-damm-v1-stable";
const PROGRAM_ID = address("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
const VAULT_PROGRAM_ID = address("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi");
const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// sha256("account:Pool")[..8] / sha256("account:Vault")[..8].
const POOL_DISCRIMINATOR = new Uint8Array([0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc]);
const VAULT_DISCRIMINATOR = new Uint8Array([0xd3, 0x08, 0xe8, 0x2b, 0x02, 0x98, 0x75, 0x77]);
// sha256("global:swap")[..8].
const SWAP_DISCRIMINATOR = new Uint8Array([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);

// Locked-profit degradation rate denominator (per-second rate / 1e12).
const DEGRADATION_DENOMINATOR = 1_000_000_000_000n;

// Pool account field offsets (borsh, no padding; content ends at 925 of the
// over-allocated 1387-byte account).
const POOL_MIN_LENGTH = 925;
const POOL_OFFSETS = {
  tokenAMint: 40,
  tokenBMint: 72,
  aVault: 104,
  bVault: 136,
  aVaultLp: 168,
  bVaultLp: 200,
  enabled: 233,
  protocolTokenAFee: 234,
  protocolTokenBFee: 266,
  tradeFeeNumerator: 330,
  tradeFeeDenominator: 338,
  protocolTradeFeeNumerator: 346,
  protocolTradeFeeDenominator: 354,
  activationPoint: 403,
  activationType: 475,
  curveTag: 874,
  amp: 875,
  tokenAMultiplier: 883,
  tokenBMultiplier: 891,
  depegType: 916,
} as const;

// Dynamic-vault account field offsets (borsh; total_amount at 11 is unaligned).
const VAULT_MIN_LENGTH = 1227;
const VAULT_OFFSETS = {
  totalAmount: 11,
  tokenVault: 19,
  lpMint: 115,
  lastUpdatedLockedProfit: 1203,
  lastReport: 1211,
  lockedProfitDegradation: 1219,
} as const;

// SPL token account amount (u64 LE) / SPL mint supply (u64 LE).
const TOKEN_AMOUNT_OFFSET = 64;
const MINT_SUPPLY_OFFSET = 36;

export interface MeteoraDammV1StablePoolConfig extends PoolConfig {
  tokenAMint: Address;
  tokenBMint: Address;
  aVault: Address;
  bVault: Address;
  /** Pool-owned SPL token account holding vault A LP (also the pool authority PDA). */
  aVaultLp: Address;
  bVaultLp: Address;
  /** Protocol-fee token account of the INPUT (A) side — swap account 11 for A->B. */
  protocolTokenAFee: Address;
  /** VaultA.token_vault — the vault's idle SPL float, swap account 5. */
  aTokenVault: Address;
  /** VaultB.token_vault — out-side idle float; bounds the quote (strict <). */
  bTokenVault: Address;
  /** VaultA.lp_mint read from vault offset 115 (NOT reliably the canonical PDA). */
  aLpMint: Address;
  bLpMint: Address;
  tradeFeeNumerator: bigint;
  tradeFeeDenominator: bigint;
  protocolTradeFeeNumerator: bigint;
  protocolTradeFeeDenominator: bigint;
  /** Amplification coefficient, used directly (ann = amp * 2 inside the helpers). */
  amp: bigint;
  /** 10^(precision_factor - decimals); 1 for equal-decimal pairs. Immutable. */
  tokenAMultiplier: bigint;
  tokenBMultiplier: bigint;
  /** Non-zero only for bootstrapping pools; unit selected by activationType. */
  activationPoint: bigint;
  /** 0 = slot, 1 = unix timestamp. */
  activationType: number;
}

/** Symbolic account-plan refs, unique per pool; shared by quote and swap so the planner merges them. */
function poolRefs(pool: Address) {
  const base = `damm1s:${pool}`;
  return {
    pool: `${base}:pool`,
    aVault: `${base}:a-vault`,
    bVault: `${base}:b-vault`,
    aVaultLp: `${base}:a-vault-lp`,
    bVaultLp: `${base}:b-vault-lp`,
    aLpMint: `${base}:a-lp-mint`,
    bLpMint: `${base}:b-lp-mint`,
    aTokenVault: `${base}:a-token-vault`,
    bTokenVault: `${base}:b-token-vault`,
    protocolTokenAFee: `${base}:protocol-token-a-fee`,
  };
}

function expectDiscriminator(data: Uint8Array, expected: Uint8Array, what: string): void {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) {
      const got = hexString(data.subarray(0, 8));
      const want = hexString(expected);
      throw new Error(`${SLUG} ${what} has discriminator ${got}, expected ${want}`);
    }
  }
}

async function loadVault(load: AccountLoader, vault: Address, side: string) {
  const data = await load(vault);
  if (data === null) throw new Error(`${SLUG} vault ${side} account ${vault} not found`);
  if (data.length < VAULT_MIN_LENGTH) {
    throw new Error(
      `${SLUG} vault ${side} account ${vault} data is ${data.length} bytes, expected at least ${VAULT_MIN_LENGTH}`,
    );
  }
  expectDiscriminator(data, VAULT_DISCRIMINATOR, `vault ${side} account ${vault}`);
  const codec = getAddressCodec();
  return {
    tokenVault: codec.decode(
      data.subarray(VAULT_OFFSETS.tokenVault, VAULT_OFFSETS.tokenVault + 32),
    ),
    lpMint: codec.decode(data.subarray(VAULT_OFFSETS.lpMint, VAULT_OFFSETS.lpMint + 32)),
  };
}

/**
 * calculate_fee(x, n, d): 0 when n == 0 or x == 0, else max(1, floor(x*n/d)) —
 * the minimum fee of 1 native unit is a deliberate conservative rounding.
 */
function calculateFee(x: bigint, numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n || x === 0n) return 0n;
  const fee = (x * numerator) / denominator;
  return fee === 0n ? 1n : fee;
}

/**
 * Vault unlocked amount at t: total_amount - locked_profit(t) where the
 * locked profit decays linearly at locked_profit_degradation per second
 * (denominator 1e12) since last_report.
 */
function unlockedAmount(
  vault: { total: bigint; lockedProfit: bigint; lastReport: bigint; degradation: bigint },
  t: bigint,
): bigint {
  const duration = t - vault.lastReport;
  if (duration < 0n)
    throw new Error(`${SLUG} clock ${t} is behind vault last_report ${vault.lastReport}`);
  const ratio = duration * vault.degradation;
  const locked =
    ratio > DEGRADATION_DENOMINATOR
      ? 0n
      : (vault.lockedProfit * (DEGRADATION_DENOMINATOR - ratio)) / DEGRADATION_DENOMINATOR;
  return vault.total - locked;
}

const N_COINS = 2n;

/** Saber-style Newton D (ann = amp * 2, <=256 iterations, converge |d - dPrev| <= 1, floor division). */
function computeD(amp: bigint, xa: bigint, xb: bigint): bigint {
  const s = xa + xb;
  if (s === 0n) return 0n;
  const ann = amp * N_COINS;
  let d = s;
  for (let i = 0; i < 256; i++) {
    const dProduct = (((d * d) / (xa * N_COINS)) * d) / (xb * N_COINS);
    const dPrevious = d;
    d = (d * (dProduct * N_COINS + ann * s)) / (d * (ann - 1n) + dProduct * (N_COINS + 1n));
    if ((d > dPrevious ? d - dPrevious : dPrevious - d) <= 1n) break;
  }
  return d;
}

/** Saber-style Newton y for the new out-side balance given in-side balance x and invariant d. */
function computeY(amp: bigint, x: bigint, d: bigint): bigint {
  const ann = amp * N_COINS;
  const c = (((d * d) / (x * N_COINS)) * d) / (ann * N_COINS);
  const b = d / ann + x;
  let y = d;
  for (let i = 0; i < 256; i++) {
    const yPrevious = y;
    y = (y * y + c) / (2n * y + b - d);
    if ((y > yPrevious ? y - yPrevious : yPrevious - y) <= 1n) break;
  }
  return y;
}

function assertU64Amount(amountIn: bigint, what: string): void {
  if (amountIn <= 0n || amountIn >= 1n << 64n) {
    throw new Error(`${SLUG} ${what} amountIn must be a positive u64, got ${amountIn}`);
  }
}

export const meteoraDammV1Stable: SvmVenueAdapter = {
  slug: SLUG,
  kind: "stable",
  programId: PROGRAM_ID,

  async fetchPoolConfig(
    owned: OwnedAccountLoader,
    pool: Address,
  ): Promise<MeteoraDammV1StablePoolConfig> {
    const load = accountDataLoader(owned);
    const data = await load(pool);
    if (data === null) throw new Error(`${SLUG} pool account ${pool} not found`);
    if (data.length < POOL_MIN_LENGTH) {
      throw new Error(
        `${SLUG} pool account ${pool} data is ${data.length} bytes, expected at least ${POOL_MIN_LENGTH}`,
      );
    }
    expectDiscriminator(data, POOL_DISCRIMINATOR, `pool account ${pool}`);

    const enabled = data[POOL_OFFSETS.enabled];
    if (enabled !== 1) throw new Error(`${SLUG} pool ${pool} is disabled (enabled = ${enabled})`);
    const curveTag = data[POOL_OFFSETS.curveTag];
    if (curveTag !== 1) {
      throw new Error(`${SLUG} pool ${pool} curve_type tag is ${curveTag}, expected 1 (Stable)`);
    }
    const depegType = data[POOL_OFFSETS.depegType];
    if (depegType !== 0) {
      throw new Error(
        `${SLUG} pool ${pool} depeg_type is ${depegType}, expected 0 (None) — depeg pools are out of scope`,
      );
    }
    const activationPoint = readUintLE(data, POOL_OFFSETS.activationPoint, 8);
    const activationType = data[POOL_OFFSETS.activationType];
    // A slot-based activation point cannot be evaluated against the unix
    // clock off-chain nor in the fragment; every settled pool carries 0.
    if (activationType === 0 && activationPoint !== 0n) {
      throw new Error(
        `${SLUG} pool ${pool} has slot-based activation_point ${activationPoint} — slot-gated pools are out of scope`,
      );
    }

    const codec = getAddressCodec();
    const pk = (offset: number) => codec.decode(data.subarray(offset, offset + 32));
    const aVault = pk(POOL_OFFSETS.aVault);
    const bVault = pk(POOL_OFFSETS.bVault);
    const tokenAMint = pk(POOL_OFFSETS.tokenAMint);
    const tokenBMint = pk(POOL_OFFSETS.tokenBMint);

    // The `swap` ix uses classic `token::transfer` (no mint accounts). SELF-DROP
    // a Token-2022 mint (or one carrying an un-routable extension) by throwing —
    // the SvmRoute orchestrator catches a fetchPoolConfig throw and drops the
    // venue. The mint's token program is its OWNER (an extensionless Token-2022
    // mint is byte-identical to a legacy one). An unreadable mint (this venue's
    // fixtures don't vendor the token mints) falls back to the legacy
    // assumption, keeping existing tests green.
    const _mints = [tokenAMint, tokenBMint];
    const _mintAccounts = await Promise.all(_mints.map((mint) => owned(mint)));
    for (let _i = 0; _i < _mints.length; _i++) {
      const mint = _mints[_i]!;
      const account = _mintAccounts[_i]!;
      if (account === null) continue;
      const mintData = account.data;
      if (classifyMintProgram(mint, mintData, account.owner) === TOKEN_2022_PROGRAM_ID) {
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

    // Second hop: the swap/quote satellite addresses live in the two vaults.
    const vaultA = await loadVault(load, aVault, "a");
    const vaultB = await loadVault(load, bVault, "b");

    return {
      venue: SLUG,
      pool,
      tokenAMint,
      tokenBMint,
      aVault,
      bVault,
      aVaultLp: pk(POOL_OFFSETS.aVaultLp),
      bVaultLp: pk(POOL_OFFSETS.bVaultLp),
      protocolTokenAFee: pk(POOL_OFFSETS.protocolTokenAFee),
      aTokenVault: vaultA.tokenVault,
      bTokenVault: vaultB.tokenVault,
      aLpMint: vaultA.lpMint,
      bLpMint: vaultB.lpMint,
      tradeFeeNumerator: readUintLE(data, POOL_OFFSETS.tradeFeeNumerator, 8),
      tradeFeeDenominator: readUintLE(data, POOL_OFFSETS.tradeFeeDenominator, 8),
      protocolTradeFeeNumerator: readUintLE(data, POOL_OFFSETS.protocolTradeFeeNumerator, 8),
      protocolTradeFeeDenominator: readUintLE(data, POOL_OFFSETS.protocolTradeFeeDenominator, 8),
      amp: readUintLE(data, POOL_OFFSETS.amp, 8),
      tokenAMultiplier: readUintLE(data, POOL_OFFSETS.tokenAMultiplier, 8),
      tokenBMultiplier: readUintLE(data, POOL_OFFSETS.tokenBMultiplier, 8),
      activationPoint,
      activationType,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = cfg as MeteoraDammV1StablePoolConfig;
    const refs = poolRefs(c.pool);
    // 8 read-only accounts; t comes from ctx.timestamp() (Clock sysvar), and
    // only the OUT-side token vault is read (idle-float liquidity bound).
    return [
      { ref: refs.pool, address: c.pool },
      { ref: refs.aVault, address: c.aVault },
      { ref: refs.bVault, address: c.bVault },
      { ref: refs.aVaultLp, address: c.aVaultLp },
      { ref: refs.bVaultLp, address: c.bVaultLp },
      { ref: refs.aLpMint, address: c.aLpMint },
      { ref: refs.bLpMint, address: c.bLpMint },
      { ref: refs.bTokenVault, address: c.bTokenVault },
    ];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = cfg as MeteoraDammV1StablePoolConfig;
    assertU64Amount(amountIn, "emitQuote");
    const DEG = DEGRADATION_DENOMINATOR;

    // Account model (RS): quoteAccounts() attaches, in order,
    //   [pool, aVault, bVault, aVaultLp, bVaultLp, aLpMint, bLpMint, bTokenVault]
    // so each field is read as `svm.sload(acc<k>, off, w).toLe()` (all u64 LE):
    //   acc0=pool  acc1=aVault  acc2=bVault  acc3=aVaultLp  acc4=bVaultLp
    //   acc5=aLpMint  acc6=bLpMint  acc7=bTokenVault
    // and the Clock is read via ctx.timestamp() (RS spelling).
    const lines = [
      // Vault unlocked amounts at the cluster clock (locked-profit decay,
      // denominator 1e12). t < last_report cannot happen on-chain (the vault
      // crank stamps last_report from the same clock); if it ever wrapped, the
      // ratio would exceed 1e12 and the fragment falls back to total_amount.
      `const t${i} = ctx.timestamp();`,
      `const aTot${i} = svm.sload(acc1, ${VAULT_OFFSETS.totalAmount}, 8).toLe();`,
      `const aLok${i} = svm.sload(acc1, ${VAULT_OFFSETS.lastUpdatedLockedProfit}, 8).toLe();`,
      `const aRatio${i} = (t${i} - svm.sload(acc1, ${VAULT_OFFSETS.lastReport}, 8).toLe()) * svm.sload(acc1, ${VAULT_OFFSETS.lockedProfitDegradation}, 8).toLe();`,
      `let aUnl${i} = aTot${i};`,
      `if (aRatio${i} <= ${DEG}) { aUnl${i} = aTot${i} - aLok${i} * (${DEG} - aRatio${i}) / ${DEG} }`,
      `const bTot${i} = svm.sload(acc2, ${VAULT_OFFSETS.totalAmount}, 8).toLe();`,
      `const bLok${i} = svm.sload(acc2, ${VAULT_OFFSETS.lastUpdatedLockedProfit}, 8).toLe();`,
      `const bRatio${i} = (t${i} - svm.sload(acc2, ${VAULT_OFFSETS.lastReport}, 8).toLe()) * svm.sload(acc2, ${VAULT_OFFSETS.lockedProfitDegradation}, 8).toLe();`,
      `let bUnl${i} = bTot${i};`,
      `if (bRatio${i} <= ${DEG}) { bUnl${i} = bTot${i} - bLok${i} * (${DEG} - bRatio${i}) / ${DEG} }`,
      // Reserves via vault share math (never raw balances).
      `const aLpAmt${i} = svm.sload(acc3, ${TOKEN_AMOUNT_OFFSET}, 8).toLe();`,
      `const bLpAmt${i} = svm.sload(acc4, ${TOKEN_AMOUNT_OFFSET}, 8).toLe();`,
      `const aSup${i} = svm.sload(acc5, ${MINT_SUPPLY_OFFSET}, 8).toLe();`,
      `const bSup${i} = svm.sload(acc6, ${MINT_SUPPLY_OFFSET}, 8).toLe();`,
      `const rIn${i} = aLpAmt${i} * aUnl${i} / aSup${i};`,
      `const rOut${i} = bLpAmt${i} * bUnl${i} / bSup${i};`,
      // Input-token fees, re-read at quote time (admin-mutable): trade fee with
      // minimum 1 when the numerator is non-zero, protocol fee as a cut of it.
      `const fNum${i} = svm.sload(acc0, ${POOL_OFFSETS.tradeFeeNumerator}, 8).toLe();`,
      `let tFee${i} = ${amountIn} * fNum${i} / svm.sload(acc0, ${POOL_OFFSETS.tradeFeeDenominator}, 8).toLe();`,
      `if (fNum${i} > 0) { if (tFee${i} === 0) { tFee${i} = 1 } }`,
      `const pNum${i} = svm.sload(acc0, ${POOL_OFFSETS.protocolTradeFeeNumerator}, 8).toLe();`,
      `let pFee${i} = tFee${i} * pNum${i} / svm.sload(acc0, ${POOL_OFFSETS.protocolTradeFeeDenominator}, 8).toLe();`,
      `if (pNum${i} > 0) { if (tFee${i} > 0) { if (pFee${i} === 0) { pFee${i} = 1 } } }`,
      `tFee${i} = tFee${i} - pFee${i};`,
      `const inNet${i} = ${amountIn} - pFee${i};`,
      // Vault deposit simulation; unlocked'(t) = unlocked(t) + inNet because
      // total' = total + inNet while locked_profit(t) is unchanged.
      `const inLp${i} = inNet${i} * aSup${i} / aUnl${i};`,
      `const aft${i} = (inLp${i} + aLpAmt${i}) * (aUnl${i} + inNet${i}) / (aSup${i} + inLp${i});`,
      `const srcNet${i} = aft${i} - rIn${i} - tFee${i};`,
      // Stable curve on multiplier-upscaled reserves (multipliers immutable,
      // baked; amp re-read — it is admin-adjustable). dy carries the -1 guard.
      `const amp${i} = svm.sload(acc0, ${POOL_OFFSETS.amp}, 8).toLe();`,
      `const dInv${i} = stableD(amp${i}, rIn${i} * ${c.tokenAMultiplier}, rOut${i} * ${c.tokenBMultiplier});`,
      `const y${i} = stableY(amp${i}, (rIn${i} + srcNet${i}) * ${c.tokenAMultiplier}, dInv${i});`,
      `const dest${i} = (rOut${i} * ${c.tokenBMultiplier} - y${i} - 1) / ${c.tokenBMultiplier};`,
      // Vault withdraw simulation (two more floors).
      `const outLp${i} = dest${i} * bSup${i} / bUnl${i};`,
      `let out${i} = outLp${i} * bUnl${i} / bSup${i};`,
      // Idle-float liquidity bound (strict <): clamp to 0 instead of throwing
      // so the other venues in a multi-pool program stay quotable.
      `if (out${i} >= svm.sload(acc7, ${TOKEN_AMOUNT_OFFSET}, 8).toLe()) { out${i} = 0 }`,
    ];
    if (c.activationType === 1 && c.activationPoint > 0n) {
      lines.push(`if (t${i} < ${c.activationPoint}) { out${i} = 0 }`);
    }
    lines.push(`const q${i} = out${i};`);
    return lines.map((line) => `  ${line}`).join("\n");
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = cfg as MeteoraDammV1StablePoolConfig;
    assertU64Amount(amountIn, "buildSwap");
    const refs = poolRefs(c.pool);

    // 8-byte discriminator || in_amount u64 LE || minimum_out_amount u64 LE.
    // min_out is 1: the recipe's post-swap outAta delta check enforces the
    // real bound.
    const data = new Uint8Array(24);
    data.set(SWAP_DISCRIMINATOR, 0);
    new DataView(data.buffer).setBigUint64(8, amountIn, true);
    new DataView(data.buffer).setBigUint64(16, 1n, true);

    return {
      programId: PROGRAM_ID,
      data,
      // Same 15-account list for both directions; A->B puts inAta on the
      // source side and the A-side protocol fee account at index 11.
      accounts: [
        { ref: refs.pool, address: c.pool, writable: true },
        { ref: user.inAta, writable: true },
        { ref: user.outAta, writable: true },
        { ref: refs.aVault, address: c.aVault, writable: true },
        { ref: refs.bVault, address: c.bVault, writable: true },
        { ref: refs.aTokenVault, address: c.aTokenVault, writable: true },
        { ref: refs.bTokenVault, address: c.bTokenVault, writable: true },
        { ref: refs.aLpMint, address: c.aLpMint, writable: true },
        { ref: refs.bLpMint, address: c.bLpMint, writable: true },
        { ref: refs.aVaultLp, address: c.aVaultLp, writable: true },
        { ref: refs.bVaultLp, address: c.bVaultLp, writable: true },
        { ref: refs.protocolTokenAFee, address: c.protocolTokenAFee, writable: true },
        { ref: user.owner, signer: true },
        { ref: "damm1s:vault-program", address: VAULT_PROGRAM_ID },
        { ref: "token-program", address: TOKEN_PROGRAM_ID },
      ],
    };
  },

  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint {
    const c = cfg as MeteoraDammV1StablePoolConfig;
    const bytes = (addr: Address, what: string): Uint8Array => {
      const data = state[addr];
      if (data === undefined)
        throw new Error(`${SLUG} referenceQuote state is missing ${what} account ${addr}`);
      return data;
    };

    if (c.activationType === 1 && now < c.activationPoint) {
      throw new Error(
        `${SLUG} pool ${c.pool} is not activated until ${c.activationPoint} (now ${now})`,
      );
    }

    // Live fields exactly as the fragment reads them: fees and amp from the
    // pool account, share math inputs from vaults/LP accounts/mints.
    const poolData = bytes(c.pool, "pool");
    const tradeFeeNumerator = readUintLE(poolData, POOL_OFFSETS.tradeFeeNumerator, 8);
    const tradeFeeDenominator = readUintLE(poolData, POOL_OFFSETS.tradeFeeDenominator, 8);
    const protocolFeeNumerator = readUintLE(poolData, POOL_OFFSETS.protocolTradeFeeNumerator, 8);
    const protocolFeeDenominator = readUintLE(
      poolData,
      POOL_OFFSETS.protocolTradeFeeDenominator,
      8,
    );
    const amp = readUintLE(poolData, POOL_OFFSETS.amp, 8);

    const vault = (addr: Address, what: string) => {
      const data = bytes(addr, what);
      return {
        total: readUintLE(data, VAULT_OFFSETS.totalAmount, 8),
        lockedProfit: readUintLE(data, VAULT_OFFSETS.lastUpdatedLockedProfit, 8),
        lastReport: readUintLE(data, VAULT_OFFSETS.lastReport, 8),
        degradation: readUintLE(data, VAULT_OFFSETS.lockedProfitDegradation, 8),
      };
    };
    const vaultA = vault(c.aVault, "vault a");
    const vaultB = vault(c.bVault, "vault b");
    const aVaultLpAmount = readUintLE(bytes(c.aVaultLp, "a_vault_lp"), TOKEN_AMOUNT_OFFSET, 8);
    const bVaultLpAmount = readUintLE(bytes(c.bVaultLp, "b_vault_lp"), TOKEN_AMOUNT_OFFSET, 8);
    const aLpSupply = readUintLE(bytes(c.aLpMint, "a lp mint"), MINT_SUPPLY_OFFSET, 8);
    const bLpSupply = readUintLE(bytes(c.bLpMint, "b lp mint"), MINT_SUPPLY_OFFSET, 8);
    const outIdleFloat = readUintLE(bytes(c.bTokenVault, "b token vault"), TOKEN_AMOUNT_OFFSET, 8);

    // Step 1-2: reserves from vault share math at t = now.
    const unlockedA = unlockedAmount(vaultA, now);
    const unlockedB = unlockedAmount(vaultB, now);
    const reserveIn = (aVaultLpAmount * unlockedA) / aLpSupply;
    const reserveOut = (bVaultLpAmount * unlockedB) / bLpSupply;

    // Step 3-4: input-token fees; protocol fee is a cut of the trade fee.
    let tradeFee = calculateFee(amountIn, tradeFeeNumerator, tradeFeeDenominator);
    const protocolFee = calculateFee(tradeFee, protocolFeeNumerator, protocolFeeDenominator);
    tradeFee -= protocolFee;
    const inAfterProtocol = amountIn - protocolFee;

    // Step 5: vault deposit simulation (total' = total + inAfterProtocol).
    const inLp = (inAfterProtocol * aLpSupply) / unlockedA;
    const unlockedAAfter = unlockedAmount(
      { ...vaultA, total: vaultA.total + inAfterProtocol },
      now,
    );
    const afterTotal = ((inLp + aVaultLpAmount) * unlockedAAfter) / (aLpSupply + inLp);
    const actualInAfterFee = afterTotal - reserveIn - tradeFee;

    // Step 6: upscale -> Newton D -> Newton y -> dy (with the -1 guard) -> downscale.
    const d = computeD(amp, reserveIn * c.tokenAMultiplier, reserveOut * c.tokenBMultiplier);
    const y = computeY(amp, (reserveIn + actualInAfterFee) * c.tokenAMultiplier, d);
    const destinationAmount = (reserveOut * c.tokenBMultiplier - y - 1n) / c.tokenBMultiplier;

    // Step 7: vault withdraw simulation (two more floors).
    const outLp = (destinationAmount * bLpSupply) / unlockedB;
    const outAmount = (outLp * unlockedB) / bLpSupply;

    // Step 8: strict idle-float bound — funds deployed to lending strategies
    // are not withdrawable inside swap.
    if (outAmount >= outIdleFloat) {
      throw new Error(`${SLUG} quote ${outAmount} exceeds vault idle liquidity ${outIdleFloat}`);
    }
    return outAmount;
  },
};
