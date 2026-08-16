/**
 * Stabble Stable Swap venue adapter — program
 * `swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ`, an N-token (2..5) Anchor
 * StableSwap. See `../stabble-common.ts` for the account layouts, the
 * Balancer-style N-token invariant math and the sibling-program citations
 * this port is verified against.
 *
 * SCOPE: this adapter (and its ladder) only quote/swap the pool's FIRST TWO
 * declared tokens (index 0 -> index 1), matching this repo's existing
 * precedent for stable-curve families — saber-stableswap and
 * meteora-damm-v1-stable are ALSO single-direction-only (`AtoB`) even though
 * saber's underlying curve supports either direction; the actual N-token
 * math below (`stableCalcOutGivenIn`) works for ANY (in, out) index pair, so
 * a follow-up widening the recipe-side `direction` string to carry an
 * arbitrary index pair (today's `applyDirection`/`REVERSE_DIRECTION`
 * machinery only supports one fixed default + one fixed reverse per family)
 * would unlock the remaining pairs of a 3-5 token pool with zero adapter
 * math changes.
 *
 * Only plain SPL-Token (Tokenkeg) mints are in scope: the v1 `swap`
 * instruction (not `swap_v2`) never references Token-2022 nor transfer-fee
 * accounting, so a pool holding a Token-2022 mint (with or without an active
 * transfer-fee extension) is rejected at fetch time rather than silently
 * mis-quoted.
 */
import { getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import {
  assertStabbleU64AmountIn,
  calcRoundedAmount,
  calcUnwrappedAmount,
  calcWrappedAmount,
  complement,
  decodeStabblePoolCommon,
  decodeStabbleVault,
  deriveStabbleVaultAuthority,
  findStabbleAta,
  mulDown,
  STABBLE_SWAP_DISCRIMINATOR,
  STABBLE_TOKEN_PROGRAM_ID,
  STABBLE_VAULT_PROGRAM_ID,
  STABLE_MAX_TOKENS,
  STABLE_SWAP_PROGRAM_ID,
  stableCalcInvariantN,
  stableCalcOutGivenIn,
  stableGetAmplification,
  stableQuoteHelperSource,
  type StabbleTokenScale,
} from '../stabble-common.js';
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'stabble-stable-swap';

// Stable variant field offsets (see ../stabble-common.ts module doc).
const AMP_INITIAL_OFFSET = 106;
const AMP_TARGET_OFFSET = 108;
const RAMP_START_OFFSET = 110;
const RAMP_STOP_OFFSET = 118;
const SWAP_FEE_OFFSET = 126;
const TOKENS_OFFSET = 134;
const TOKEN_SIZE = 50;
const POOL_MIN_LENGTH = 138; // disc+owner+vault+mint+bump+active+amp*2+ramp*2+fee+vec-len, zero tokens

export interface StabbleStableToken extends StabbleTokenScale {
  mint: Address;
  decimals: number;
  balance: bigint;
  /** ATA(vaultAuthority, mint) under classic SPL Token — resolved once at fetch time. */
  vaultTokenAccount: Address;
}

export interface StabbleStableSwapPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  vault: Address;
  authorityBump: number;
  isActive: boolean;
  ampInitialFactor: number;
  ampTargetFactor: number;
  rampStartTs: bigint;
  rampStopTs: bigint;
  swapFee: bigint;
  tokens: StabbleStableToken[];
  vaultAuthority: Address;
  withdrawAuthority: Address;
  beneficiary: Address;
  beneficiaryTokenOut: Address;
}

function asStableConfig(cfg: PoolConfig): StabbleStableSwapPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`stabble-stable-swap adapter got a config for venue '${cfg.venue}'`);
  return cfg as StabbleStableSwapPoolConfig;
}

export const stabbleStableSwap: SvmVenueAdapter = {
  slug: SLUG,
  kind: 'stable',
  programId: STABLE_SWAP_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<StabbleStableSwapPoolConfig> {
    const data = await load(pool);
    const common = decodeStabblePoolCommon(pool, data, SLUG, TOKENS_OFFSET, TOKEN_SIZE, false, POOL_MIN_LENGTH);
    if (common.tokens.length > STABLE_MAX_TOKENS) {
      throw new Error(`${SLUG} pool ${pool} has ${common.tokens.length} tokens, expected at most ${STABLE_MAX_TOKENS}`);
    }
    if (!common.isActive) throw new Error(`${SLUG} pool ${pool} is not active`);

    const codec = getAddressCodec();
    const vaultData = await load(common.vault);
    const vault = decodeStabbleVault(pool, vaultData);
    if (!vault.isActive) throw new Error(`${SLUG} pool ${pool}'s vault ${common.vault} is not active`);
    const vaultAuthority = deriveStabbleVaultAuthority(common.vault, vault.authorityBump);

    // Only the first two tokens are wired for quoting/swapping (see module doc).
    const [tokenA, tokenB] = common.tokens;
    // The v1 `swap` ix is legacy-SPL (Tokenkeg) only — no Token-2022 /
    // transfer-fee accounting — so SELF-DROP a pool holding a Token-2022 mint
    // (or an un-routable extension mint). The thrown error is the graceful-drop
    // signal (SvmRoute drops the venue on a fetchPoolConfig throw). An
    // unreadable mint falls back to the legacy assumption, keeping the
    // byte-identical legacy path. (The previous "guard" cited in the module doc
    // was a dead no-op in stabble-common's decodeStabblePoolCommon; this is the
    // real, data-shape-based detection.)
    for (const mint of [tokenA.mint, tokenB.mint]) {
      const mintData = await load(mint);
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
      }
    }
    const vaultTokenA = await findStabbleAta(vaultAuthority, tokenA.mint);
    const vaultTokenB = await findStabbleAta(vaultAuthority, tokenB.mint);
    const beneficiaryTokenOut = await findStabbleAta(vault.beneficiary, tokenB.mint);

    const tokens: StabbleStableToken[] = [
      { ...tokenA, vaultTokenAccount: vaultTokenA },
      { ...tokenB, vaultTokenAccount: vaultTokenB },
    ];

    const swapFee = readUintLE(data as Uint8Array, SWAP_FEE_OFFSET, 8);
    if (swapFee === 0n) {
      // Not itself invalid on-chain, but the `complement`-based fee math still
      // works fine at 0 — no gate needed (unlike a zero DENOMINATOR elsewhere
      // in this codebase, swap_fee is a fixed-point NUMERATOR at ONE-scale).
    }

    return {
      venue: SLUG,
      pool,
      vault: common.vault,
      authorityBump: common.authorityBump,
      isActive: common.isActive,
      ampInitialFactor: Number(readUintLE(data as Uint8Array, AMP_INITIAL_OFFSET, 2)),
      ampTargetFactor: Number(readUintLE(data as Uint8Array, AMP_TARGET_OFFSET, 2)),
      rampStartTs: readUintLE(data as Uint8Array, RAMP_START_OFFSET, 8),
      rampStopTs: readUintLE(data as Uint8Array, RAMP_STOP_OFFSET, 8),
      swapFee,
      tokens,
      vaultAuthority,
      withdrawAuthority: vault.withdrawAuthority,
      beneficiary: vault.beneficiary,
      beneficiaryTokenOut,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = asStableConfig(cfg);
    return [{ ref: c.pool, address: c.pool }];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = asStableConfig(cfg);
    assertStabbleU64AmountIn(amountIn, `${SLUG} emitQuote`);
    const pool = JSON.stringify(c.pool);
    const [tokenIn, tokenOut] = c.tokens;
    const n = c.tokens.length; // always 2 in this adapter's AtoB-only scope

    const wrappedIn = calcWrappedAmount(amountIn, tokenIn);
    const lines: string[] = [`  let amp${i} = ${c.ampTargetFactor * 1000};`];
    const range = c.rampStopTs - c.rampStartTs;
    if (c.rampStopTs !== 0n && range > 0n && c.ampInitialFactor !== c.ampTargetFactor) {
      const targetUp = c.ampTargetFactor >= c.ampInitialFactor;
      const lo = targetUp ? c.ampInitialFactor : c.ampTargetFactor;
      const hi = targetUp ? c.ampTargetFactor : c.ampInitialFactor;
      const interp = targetUp
        ? `${c.ampInitialFactor * 1000} + Math.mulDiv(${(hi - lo) * 1000}, ((block.timestamp - ${c.rampStartTs}) / 60) * 60, ${range})`
        : `${c.ampInitialFactor * 1000} - Math.mulDiv(${(hi - lo) * 1000}, ((block.timestamp - ${c.rampStartTs}) / 60) * 60, ${range})`;
      lines.push(`  if (block.timestamp <= ${c.rampStartTs}) { amp${i} = ${c.ampInitialFactor * 1000} }`);
      lines.push(`  else if (block.timestamp < ${c.rampStopTs}) { amp${i} = ${interp} }`);
    }
    lines.push(`  const bal0_${i} = accountUint(${pool}, ${TOKENS_OFFSET + 4 + 42}, 8);`);
    lines.push(`  const bal1_${i} = accountUint(${pool}, ${TOKENS_OFFSET + 4 + TOKEN_SIZE + 42}, 8);`);
    // Self-contained: this v1 adapter has no shared "declare once" helper
    // seam (unlike the ladder's helpers()), so the N-token Newton helper is
    // declared inline, per-call — safe for a solo compile of this one
    // fragment (this adapter's only known caller today), NOT safe to mix
    // verbatim into a multi-pool program without deduping the declaration.
    const helper = stableQuoteHelperSource(n);
    const renamed = helper.source.replace(helper.name, `${helper.name}_${i}`);
    lines.push(renamed);
    lines.push(`  const rawOut${i} = ${helper.name}_${i}(amp${i}, bal0_${i}, bal1_${i}, ${wrappedIn});`);
    lines.push(`  const fee${i} = accountUint(${pool}, ${SWAP_FEE_OFFSET}, 8);`);
    lines.push(`  const netOut${i} = Math.mulDiv(rawOut${i}, 1000000000 - fee${i}, 1000000000);`);
    const unwrapExpr =
      tokenOut.scalingFactor === 1n
        ? `netOut${i}`
        : tokenOut.scalingUp
          ? `netOut${i} / ${tokenOut.scalingFactor}`
          : `netOut${i} * ${tokenOut.scalingFactor}`;
    lines.push(`  const q${i} = ${unwrapExpr};`);
    return lines.join('\n');
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = asStableConfig(cfg);
    assertStabbleU64AmountIn(amountIn, `${SLUG} buildSwap`);
    const [tokenIn, tokenOut] = c.tokens;

    // disc(8) | Option<u64> tag=1 (8) | amount_in u64 LE (8) | minimum_amount_out u64 LE (8, =1).
    const data = new Uint8Array(25);
    data.set(STABBLE_SWAP_DISCRIMINATOR, 0);
    data[8] = 1;
    new DataView(data.buffer).setBigUint64(9, amountIn, true);
    new DataView(data.buffer).setBigUint64(17, 1n, true);

    return {
      programId: STABLE_SWAP_PROGRAM_ID,
      data,
      accounts: [
        { ref: user.owner, signer: true },
        { ref: user.inAta, writable: true },
        { ref: user.outAta, writable: true },
        { ref: tokenIn.vaultTokenAccount, address: tokenIn.vaultTokenAccount, writable: true },
        { ref: tokenOut.vaultTokenAccount, address: tokenOut.vaultTokenAccount, writable: true },
        { ref: c.beneficiaryTokenOut, address: c.beneficiaryTokenOut, writable: true },
        { ref: c.pool, address: c.pool, writable: true },
        { ref: c.withdrawAuthority, address: c.withdrawAuthority },
        { ref: c.vault, address: c.vault },
        { ref: c.vaultAuthority, address: c.vaultAuthority },
        { ref: STABBLE_VAULT_PROGRAM_ID, address: STABBLE_VAULT_PROGRAM_ID },
        { ref: STABBLE_TOKEN_PROGRAM_ID, address: STABBLE_TOKEN_PROGRAM_ID },
      ],
    };
  },

  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint {
    const c = asStableConfig(cfg);
    if (amountIn < 0n) throw new Error(`${SLUG} amountIn must be non-negative, got ${amountIn}`);
    if (amountIn === 0n) return 0n;
    assertStabbleU64AmountIn(amountIn, `${SLUG} referenceQuote`);

    const poolData = state[c.pool];
    if (poolData === undefined) throw new Error(`${SLUG} referenceQuote state is missing pool ${c.pool}`);
    const [tokenIn, tokenOut] = c.tokens;
    const bal0 = readUintLE(poolData, TOKENS_OFFSET + 4 + 42, 8);
    const bal1 = readUintLE(poolData, TOKENS_OFFSET + 4 + TOKEN_SIZE + 42, 8);
    const swapFee = readUintLE(poolData, SWAP_FEE_OFFSET, 8);
    const amp = stableGetAmplification(c.ampInitialFactor, c.ampTargetFactor, c.rampStartTs, c.rampStopTs, now);

    const balances = [bal0, bal1];
    const invariant = stableCalcInvariantN(amp, balances);
    const wrappedIn = calcWrappedAmount(amountIn, tokenIn);
    const rawOut = stableCalcOutGivenIn(amp, balances, 0, 1, wrappedIn, invariant);
    const netOut = mulDown(rawOut, complement(swapFee));
    return calcUnwrappedAmount(netOut, tokenOut);
  },
};

export { calcRoundedAmount as stabbleStableSwapCalcRoundedAmount };
