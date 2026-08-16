/**
 * Cropper (Solana CLMM) venue — pool decoding, scope gates and the
 * prepare-declared tick-boundary WINDOW for the SvmRoute ladder fragment
 * (./ladder.ts).
 *
 * It is, byte-for-byte, the same Whirlpool/TickArray
 * account layout AND `swap` instruction as the sibling
 * orca-whirlpool venue (Cropper's AMM program is a verbatim fork of Orca's
 * Whirlpool at the account/instruction level — GROUND-TRUTHED, not assumed,
 * against real mainnet state and a real transaction 2026-07-31, NOT merely
 * inferred from the lineage rumour that it is a spl-token-swap clone
 * (measured: zero accounts at spl-token-swap's 324-byte size on this
 * program) — a separate Cropper CLMM program exists and is NOT this one:
 *   - pool account `7vKAxPYgE3wcQS9TpUSqanyk1shWswt8bUCLKcNyiNYW` (SOL/token,
 *     tickSpacing 64, live liquidity ~1.51e11): 653 bytes, discriminator
 *     3f 95 d1 0c e1 80 63 09 (sha256('account:Whirlpool')[0..8]), field
 *     offsets IDENTICAL to orca-whirlpool's (tick_spacing@41, fee_rate@45,
 *     liquidity@49, sqrt_price@65, tick_current_index@81, token_mint_a@101,
 *     token_vault_a@133, token_mint_b@181, token_vault_b@213,
 *     reward_last_updated_timestamp@261, reward_infos[3]@269..653);
 *   - its TickArray accounts (9988 bytes, disc 45 61 bd be 6e 07 42 bb)
 *     decode with the SAME offsets, and the `tick_array` PDA seeds
 *     (['tick_array', pool, decimal-string(startTick)], THIS program's id)
 *     reproduce the exact tick-array address a real transaction referenced
 *     on-chain for this pool (signature
 *     37GvzdwkDVXCYzXfoUVXfQNMvZiyThmFk53gsuAsKvF8BNfhnPGk1ScjCToRmkgYFZsp8huURV1BMD8XwQpef1jb) —
 *     the SAME `oracle` PDA seed too;
 *   - the swap instruction is the classic (non-`_v2`) Anchor `swap`
 *     (discriminator sha256('global:swap')[0..8] = f8 c6 9e 91 e1 75 87 c8,
 *     a pure function of the instruction NAME, so necessarily identical for
 *     any Anchor program naming it the same) with the IDENTICAL 42-byte
 *     layout (disc ++ amount u64 LE ++ other_amount_threshold u64 LE ++
 *     sqrt_price_limit u128 LE ++ amount_specified_is_input u8 ++ a_to_b u8)
 *     and the IDENTICAL 11-account order (tokenProgram, tokenAuthority,
 *     whirlpool, tokenOwnerAccountA, tokenVaultA, tokenOwnerAccountB,
 *     tokenVaultB, tickArray0, tickArray1, tickArray2, oracle) — confirmed
 *     against that same real transaction's inner-instruction data AND by
 *     simulating fresh swaps at three sizes (0.03 / 0.07 / 0.12 SOL, 0/2/2
 *     tick crossings) against the REAL deployed program on REAL live
 *     mainnet state: the ladder's predicted output below matches the
 *     realized token-vault delta EXACTLY (0 bps) at every size.
 *
 * Given the confirmed byte-identical layout, this module reuses
 * orca-whirlpool's PURE math and PDA-independent helpers straight from the
 * `@eco-incorp/sauce-sdk/svm` barrel (whirlpoolSqrtPriceAtTick, the account
 * discriminators, MIN_TICK_INDEX / MAX_TICK_INDEX, the OFF_* offsets,
 * TICK_ARRAY_SIZE / TICK_LEN, and the PROGRAM-INDEPENDENT windowStartTicks)
 * — nothing here reinvents that arithmetic. Only the parts that are
 * genuinely PROGRAM-BOUND (the PDA derivations and the CPI target) are
 * reimplemented, against this venue's own program id. The
 * MIN/MAX sqrt-price sentinels are not exported by the SDK barrel (they are
 * an orca-whirlpool-internal constant), so they are redeclared locally —
 * see CROPPER_MIN_SQRT_PRICE/CROPPER_MAX_SQRT_PRICE below; CROPPER_MAX_BOUNDARIES
 * is likewise an independent local constant (kept numerically equal to
 * orca-whirlpool's by design, not imported, so a future SDK change to that
 * venue's own sizing can never silently reshape this one — the same
 * defensive-independence convention this repo's other CLMM-fork venues use).
 *
 * Gates mirror orca-whirlpool's exactly (see that adapter's header for the
 * full rationale): account size/discriminator, `fee_tier_index !=
 * tick_spacing` (adaptive-fee pools skipped — their effective fee depends on
 * Oracle volatility state the fragment does not read), non-Tokenkeg mints
 * (the swap ix is classic-SPL only), and a direction with no shipped
 * boundaries/edge (gated by the orchestrator via windowFor).
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
import { address, getAddressCodec, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { MAX_TICK_INDEX, MIN_TICK_INDEX, whirlpoolSqrtPriceAtTick } from '../orca-whirlpool/tick-math.js';
import { OFF_FEE_RATE, OFF_FEE_TIER_INDEX, OFF_LIQUIDITY, OFF_SQRT_PRICE, OFF_TA_START, OFF_TA_TICKS, OFF_TICK_CURRENT, OFF_TICK_SPACING, TICK_ARRAY_ACCOUNT_SIZE, TICK_ARRAY_DISCRIMINATOR, TICK_ARRAY_SIZE, TICK_LEN, WHIRLPOOL_ACCOUNT_SIZE, WHIRLPOOL_DISCRIMINATOR, windowStartTicks } from '../orca-whirlpool/index.js';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'cropper';

/** Cropper's AMM (Whirlpool-lineage CLMM) program. */
export const CROPPER_PROGRAM_ID = address('H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export { WHIRLPOOL_ACCOUNT_SIZE as CROPPER_POOL_ACCOUNT_SIZE, TICK_ARRAY_ACCOUNT_SIZE as CROPPER_TICK_ARRAY_ACCOUNT_SIZE };

/**
 * Sentinels the venue's `swap` substitutes when no explicit per-pool limit is
 * given (NOT exported by the SDK barrel — orca-whirlpool's own
 * MIN_SQRT_PRICE/MAX_SQRT_PRICE live in that venue's internal tick-math.ts,
 * unreachable through the public svm barrel — redeclared here byte-equal;
 * see docs/svm-venues.md-style provenance in the module header above).
 */
export const CROPPER_MIN_SQRT_PRICE = 4_295_048_016n;
export const CROPPER_MAX_SQRT_PRICE = 79_226_673_515_401_279_992_447_579_055n;

/**
 * Shipped initialized-tick boundaries per direction — independent of
 * orca-whirlpool's own WHIRLPOOL_MAX_BOUNDARIES by design (see the module
 * header), kept numerically equal (4) for the same measured per-step CU
 * economics (a crossed boundary is ~45k CU in the walk, per orca-whirlpool's
 * own budget.ts commentary).
 */
export const CROPPER_MAX_BOUNDARIES = 4;

export interface CropperBoundary {
  arrayIndex: number;
  offset: number;
  tick: number;
  sqrtPrice: bigint;
}

export interface CropperWindow {
  tickArrays: [Address, Address, Address];
  startTicks: [number, number, number];
  boundaries: CropperBoundary[];
  edge: { tick: number; sqrtPrice: bigint } | null;
  readable: number;
}

export interface CropperPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** Trade direction: 'aToB' (default) sells token A for token B. */
  direction: 'aToB' | 'bToA';
  tokenMintA: Address;
  tokenMintB: Address;
  tokenVaultA: Address;
  tokenVaultB: Address;
  /** PDA ['oracle', pool] — uninitialized for static-fee pools, but the swap ix requires it. */
  oracle: Address;
  tickSpacing: number;
  feeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  windows: { aToB: CropperWindow; bToA: CropperWindow };
}

const readI32 = (data: Uint8Array, offset: number): number => {
  const u = Number(readUintLE(data, offset, 4));
  return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
};

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}

function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

async function deriveTickArrayPda(pool: Address, startTick: number): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: CROPPER_PROGRAM_ID,
    seeds: [new TextEncoder().encode('tick_array'), getAddressEncoded(pool), new TextEncoder().encode(String(startTick))],
  });
  return pda;
}

/**
 * Scan the readable window for initialized-tick boundaries in walk order —
 * the venue's get_next_init_tick_index semantics (byte-identical to
 * orca-whirlpool's own resolveWindow): aToB searches DOWN from the live tick
 * INCLUSIVE, bToA searches UP exclusive; later arrays search their full
 * span. The edge is shipped only when the scan exhausted the readable
 * window.
 */
async function resolveWindow(
  load: AccountLoader,
  pool: Address,
  tickCurrentIndex: number,
  tickSpacing: number,
  aToB: boolean,
): Promise<CropperWindow> {
  const startTicks = windowStartTicks(tickCurrentIndex, tickSpacing, aToB);
  const tickArrays = (await Promise.all(startTicks.map((start) => deriveTickArrayPda(pool, start)))) as [
    Address,
    Address,
    Address,
  ];

  const arrays: Uint8Array[] = [];
  let readable = 0;
  for (let i = 0; i < 3; i++) {
    const data = await load(tickArrays[i]);
    const valid =
      data !== null &&
      data.length >= TICK_ARRAY_ACCOUNT_SIZE &&
      hasDiscriminator(data, TICK_ARRAY_DISCRIMINATOR) &&
      readI32(data, OFF_TA_START) === startTicks[i];
    if (!valid) break;
    arrays.push(data);
    readable += 1;
  }

  const boundaries: CropperBoundary[] = [];
  let maxStopped = false;
  for (let a = 0; a < readable && !maxStopped; a++) {
    const data = arrays[a]!;
    const start = startTicks[a]!;
    let offset: number;
    if (a === 0) {
      const raw = Math.floor((tickCurrentIndex - start) / tickSpacing);
      offset = aToB ? raw : raw + 1;
    } else {
      offset = aToB ? TICK_ARRAY_SIZE - 1 : 0;
    }
    if (!aToB && offset < 0) offset = 0;
    while (offset >= 0 && offset < TICK_ARRAY_SIZE) {
      if (data[OFF_TA_TICKS + offset * TICK_LEN] === 1) {
        const tick = start + offset * tickSpacing;
        boundaries.push({ arrayIndex: a, offset, tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) });
        if (boundaries.length === CROPPER_MAX_BOUNDARIES) {
          maxStopped = true;
          break;
        }
      }
      offset += aToB ? -1 : 1;
    }
  }

  let edge: CropperWindow['edge'] = null;
  if (readable > 0 && !maxStopped) {
    const lastStart = startTicks[readable - 1]!;
    let tick: number;
    if (aToB) {
      tick = Math.max(lastStart, MIN_TICK_INDEX);
    } else {
      tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
      if (lastStart + TICK_ARRAY_SIZE * tickSpacing > MAX_TICK_INDEX) tick = MAX_TICK_INDEX;
    }
    edge = { tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) };
  }

  return { tickArrays, startTicks, boundaries, edge, readable };
}

/**
 * Fetch + gate one Cropper pool (see the header for the gate list) and
 * freeze both directions' boundary windows. Read-only against the loader.
 */
export async function fetchCropperConfig(load: AccountLoader, pool: Address): Promise<CropperPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== WHIRLPOOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected ${WHIRLPOOL_ACCOUNT_SIZE}`);
  }
  if (!hasDiscriminator(data, WHIRLPOOL_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a Whirlpool-shaped account)`);
  }

  const tickSpacing = Number(readUintLE(data, OFF_TICK_SPACING, 2));
  const feeTierIndex = Number(readUintLE(data, OFF_FEE_TIER_INDEX, 2));
  if (feeTierIndex !== tickSpacing) {
    throw new Error(
      `${SLUG}: pool ${pool} uses an adaptive fee tier (fee_tier_index ${feeTierIndex} != tick_spacing ${tickSpacing}) — ` +
        'the effective fee depends on Oracle volatility state the in-VM quote does not read',
    );
  }

  const codec = getAddressCodec();
  const OFF_MINT_A = 101;
  const OFF_VAULT_A = 133;
  const OFF_MINT_B = 181;
  const OFF_VAULT_B = 213;
  const tokenMintA = codec.decode(data.subarray(OFF_MINT_A, OFF_MINT_A + 32)) as Address;
  const tokenMintB = codec.decode(data.subarray(OFF_MINT_B, OFF_MINT_B + 32)) as Address;
  // The swap ix is Tokenkeg-only, so a Token-2022 mint (or one carrying an
  // un-routable extension) SELF-DROPS this pool: the thrown error is the
  // graceful-drop signal the SvmRoute orchestrator catches. An unreadable mint
  // falls back to the legacy assumption (a classic 82-byte mint classifies
  // legacy → no throw → config built byte-identically to before).
  for (const mint of [tokenMintA, tokenMintB]) {
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

  const tickCurrentIndex = readI32(data, OFF_TICK_CURRENT);
  const [aToB, bToA, oracle] = await Promise.all([
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, true),
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, false),
    getProgramDerivedAddress({
      programAddress: CROPPER_PROGRAM_ID,
      seeds: [new TextEncoder().encode('oracle'), getAddressEncoded(pool)],
    }).then(([pda]) => pda),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: 'aToB',
    tokenMintA,
    tokenMintB,
    tokenVaultA: codec.decode(data.subarray(OFF_VAULT_A, OFF_VAULT_A + 32)) as Address,
    tokenVaultB: codec.decode(data.subarray(OFF_VAULT_B, OFF_VAULT_B + 32)) as Address,
    oracle,
    tickSpacing,
    feeRate: Number(readUintLE(data, OFF_FEE_RATE, 2)),
    liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
    sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
    tickCurrentIndex,
    windows: { aToB, bToA },
  };
}

/** Family facade for the recipe orchestrator (ladder-only — no v1 adapter). */
export const cropper = {
  slug: SLUG,
  programId: CROPPER_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchCropperConfig,
};
