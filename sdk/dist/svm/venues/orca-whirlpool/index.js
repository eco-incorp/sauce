/**
 * Orca Whirlpools (CLMM) venue — pool decoding, scope gates and the
 * prepare-declared tick-boundary WINDOW for the SvmRoute ladder fragment
 * (./ladder.ts). This family is LADDER-ONLY (adapter contract v2): a CLMM
 * quote is a tick walk over a data-dependent account set, which does not fit
 * the one-adapter-one-pool v1 shape — so there is no SvmVenueAdapter here and
 * the venue is not in the v1 registry.
 *
 * Layout source-verified against github.com/orca-so/whirlpools
 * (programs/whirlpool/src/state/{whirlpool,tick,fixed_tick_array}.rs) AND a
 * mainnet dump of the SOL/USDC 0.04% pool (Czfq3xZZ..., snapshot slot
 * 431094837, sdk/test/svm/fixtures/orca-whirlpool/): Whirlpool = 653 bytes
 * (8 + 261 + 384), discriminator sha256('account:Whirlpool')[0..8] =
 * 3f 95 d1 0c e1 80 63 09; FixedTickArray = 9988 bytes (8 + 4 + 88*113 + 32),
 * discriminator sha256('account:TickArray')[0..8] = 45 61 bd be 6e 07 42 bb.
 * All integers little-endian; liquidity_net is i128 LE two's-complement and
 * tick indices are i32 LE two's-complement (read unsigned + biased by 2^31).
 *
 * THE WINDOW (the pinned Phase 2 design, shaped by measured engine costs —
 * an in-VM per-slot flag scan plus tick-math bit ladders costs 8k/54k CU per
 * step on the interpreter, so live DISCOVERY is unaffordable): prepare walks
 * the tick arrays OFF-CHAIN and ships up to WHIRLPOOL_MAX_BOUNDARIES
 * initialized-tick boundaries per direction — each as (arrayIndex, offset,
 * biased tick, sqrt price) — plus the swap-sequence EDGE target. Everything
 * VALUE-BEARING stays live: the fragment re-reads sqrt_price /
 * tick_current_index / liquidity / fee_rate from the pool and each shipped
 * boundary's initialized flag + liquidity_net i128 from its tick array at
 * cook time. The shipped parts are drift-invariant by construction: a tick
 * array PDA encodes (whirlpool, start_tick_index), so a shipped offset's
 * TICK INDEX can never change, and sqrt_price_from_tick_index is a pure
 * function of the tick. Drift semantics:
 * - pool price/liquidity drift: exact (live reads; boundaries behind the
 *   live tick are skipped in-VM, matching the venue's search direction);
 * - a shipped tick REMOVED (flag now 0): exact (the venue no longer steps
 *   there; the fragment skips it the same way);
 * - a shipped tick's NET changed: exact (read live);
 * - a NEW tick initialized inside a shipped gap: the model misses a step the
 *   venue takes — added liquidity only improves the realized output, and the
 *   terminal outAta delta check still enforces minOut (documented one-sided
 *   drift, like the pumpswap fee-tier snapshot);
 * - the live tick drifting past the whole shipped set: the venue
 *   SELF-DEACTIVATES (quote 0) — there is no out-of-window fallback.
 *
 * The three swap-sequence TickArray PDAs always ride the transaction for the
 * venue CPI (the program proxies uninitialized ones as zeroed arrays, so
 * real capacity is >= the modeled window and the capacity clamp stays
 * conservative).
 *
 * Gates (named errors, everything else is a live read):
 * - account size / discriminator;
 * - adaptive-fee pools (fee_tier_index != tick_spacing): their effective fee
 *   depends on Oracle volatility state the fragment does not read;
 * - non-Tokenkeg mints: the ladder's swap template is the v1 `swap`
 *   instruction, which is classic-SPL only (Token-2022 pools need swap_v2);
 * - a direction with NO shipped boundaries and no edge — nothing to walk
 *   (gated per direction by the recipe orchestrator via windowFor).
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
import { readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
import { MAX_TICK_INDEX, MIN_TICK_INDEX, whirlpoolSqrtPriceAtTick } from './tick-math.js';
const SLUG = 'orca-whirlpool';
export const ORCA_WHIRLPOOL_PROGRAM_ID = address('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const WHIRLPOOL_ACCOUNT_SIZE = 653;
export const TICK_ARRAY_ACCOUNT_SIZE = 9988;
/** sha256('account:Whirlpool')[0..8]. */
export const WHIRLPOOL_DISCRIMINATOR = [0x3f, 0x95, 0xd1, 0x0c, 0xe1, 0x80, 0x63, 0x09];
/** sha256('account:TickArray')[0..8] — the FIXED tick array (the only readable kind). */
export const TICK_ARRAY_DISCRIMINATOR = [0x45, 0x61, 0xbd, 0xbe, 0x6e, 0x07, 0x42, 0xbb];
export const TICK_ARRAY_SIZE = 88;
export { MAX_TICK_INDEX, MIN_TICK_INDEX };
/**
 * Shipped initialized-tick boundaries per direction. Sized against the
 * engine's measured per-step cost (a crossed boundary is ~45k CU in the
 * walk); raising it widens per-slot capacity at ~3 cfg words + one walk
 * iteration apiece and must move in lockstep with the fragment's unrolled
 * setup (ladder.ts) and the mirror.
 */
export const WHIRLPOOL_MAX_BOUNDARIES = 4;
// Whirlpool account offsets (state/whirlpool.rs declared order, repr(C)).
export const OFF_TICK_SPACING = 41;
export const OFF_FEE_TIER_INDEX = 43;
export const OFF_FEE_RATE = 45;
export const OFF_LIQUIDITY = 49;
export const OFF_SQRT_PRICE = 65;
export const OFF_TICK_CURRENT = 81;
const OFF_MINT_A = 101;
const OFF_VAULT_A = 133;
const OFF_MINT_B = 181;
const OFF_VAULT_B = 213;
// TickArray offsets: start_tick_index i32 @8, ticks[88] of 113 bytes @12
// ({initialized u8, liquidity_net i128 LE, liquidity_gross u128 LE, ...}),
// whirlpool pubkey @9956.
export const OFF_TA_START = 8;
export const OFF_TA_TICKS = 12;
export const TICK_LEN = 113;
export const OFF_TA_WHIRLPOOL = 9956;
const readI32 = (data, offset) => {
    const u = Number(readUintLE(data, offset, 4));
    return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
};
function hasDiscriminator(data, discriminator) {
    return discriminator.every((byte, i) => data[i] === byte);
}
function getAddressEncoded(value) {
    return new Uint8Array(getAddressCodec().encode(value));
}
async function deriveTickArrayPda(pool, startTick) {
    const [pda] = await getProgramDerivedAddress({
        programAddress: ORCA_WHIRLPOOL_PROGRAM_ID,
        seeds: [new TextEncoder().encode('tick_array'), getAddressEncoded(pool), new TextEncoder().encode(String(startTick))],
    });
    return pda;
}
/** floor division toward negative infinity (the program's floor_division). */
const floorDiv = (a, b) => Math.floor(a / b);
/**
 * The program's expected window start indexes for a direction
 * (sparse_swap.rs get_start_tick_indexes), unfiltered: exactly three,
 * including any outside the initializable range (those PDAs never exist and
 * stay beyond `readable`).
 */
export function windowStartTicks(tickCurrentIndex, tickSpacing, aToB) {
    const span = TICK_ARRAY_SIZE * tickSpacing;
    const base = floorDiv(tickCurrentIndex, span) * span;
    if (aToB)
        return [base, base - span, base - 2 * span];
    const shifted = tickCurrentIndex + tickSpacing >= base + span;
    return shifted ? [base + span, base + 2 * span, base + 3 * span] : [base, base + span, base + 2 * span];
}
/**
 * Scan the readable window for initialized-tick boundaries in walk order —
 * the venue's get_next_init_tick_index semantics: aToB searches DOWN from
 * the live tick INCLUSIVE, bToA searches UP exclusive; later arrays search
 * their full span. The edge is shipped only when the scan exhausted the
 * readable window (see WhirlpoolWindow.edge).
 */
async function resolveWindow(load, pool, tickCurrentIndex, tickSpacing, aToB) {
    const startTicks = windowStartTicks(tickCurrentIndex, tickSpacing, aToB);
    const tickArrays = (await Promise.all(startTicks.map((start) => deriveTickArrayPda(pool, start))));
    const arrays = [];
    let readable = 0;
    for (let i = 0; i < 3; i++) {
        const data = await load(tickArrays[i]);
        const valid = data !== null &&
            data.length >= TICK_ARRAY_ACCOUNT_SIZE &&
            hasDiscriminator(data, TICK_ARRAY_DISCRIMINATOR) &&
            readI32(data, OFF_TA_START) === startTicks[i];
        if (!valid)
            break;
        arrays.push(data);
        readable += 1;
    }
    const boundaries = [];
    let maxStopped = false;
    for (let a = 0; a < readable && !maxStopped; a++) {
        const data = arrays[a];
        const start = startTicks[a];
        // First array: aToB from the live tick's offset inclusive, bToA strictly
        // above it (floor(tick - start / ts) + 1, clamped up from the shifted
        // -1). Later arrays: their full span.
        let offset;
        if (a === 0) {
            const raw = floorDiv(tickCurrentIndex - start, tickSpacing);
            offset = aToB ? raw : raw + 1;
        }
        else {
            offset = aToB ? TICK_ARRAY_SIZE - 1 : 0;
        }
        if (!aToB && offset < 0)
            offset = 0;
        while (offset >= 0 && offset < TICK_ARRAY_SIZE) {
            if (data[OFF_TA_TICKS + offset * TICK_LEN] === 1) {
                const tick = start + offset * tickSpacing;
                boundaries.push({ arrayIndex: a, offset, tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) });
                if (boundaries.length === WHIRLPOOL_MAX_BOUNDARIES) {
                    maxStopped = true;
                    break;
                }
            }
            offset += aToB ? -1 : 1;
        }
    }
    let edge = null;
    if (readable > 0 && !maxStopped) {
        const lastStart = startTicks[readable - 1];
        let tick;
        if (aToB) {
            tick = Math.max(lastStart, MIN_TICK_INDEX); // is_min_tick_array => MIN bound
        }
        else {
            tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
            if (lastStart + TICK_ARRAY_SIZE * tickSpacing > MAX_TICK_INDEX)
                tick = MAX_TICK_INDEX;
        }
        edge = { tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) };
    }
    return { tickArrays, startTicks, boundaries, edge, readable };
}
/**
 * Fetch + gate one whirlpool (see the header for the gate list) and freeze
 * both directions' boundary windows. Read-only against the loader.
 */
export async function fetchOrcaWhirlpoolConfig(load, pool) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`${SLUG}: pool account ${pool} not found`);
    if (data.length !== WHIRLPOOL_ACCOUNT_SIZE) {
        throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected ${WHIRLPOOL_ACCOUNT_SIZE}`);
    }
    if (!hasDiscriminator(data, WHIRLPOOL_DISCRIMINATOR)) {
        throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a Whirlpool account)`);
    }
    const tickSpacing = Number(readUintLE(data, OFF_TICK_SPACING, 2));
    const feeTierIndex = Number(readUintLE(data, OFF_FEE_TIER_INDEX, 2));
    if (feeTierIndex !== tickSpacing) {
        throw new Error(`${SLUG}: pool ${pool} uses an adaptive fee tier (fee_tier_index ${feeTierIndex} != tick_spacing ${tickSpacing}) — ` +
            'the effective fee depends on Oracle volatility state the in-VM quote does not read');
    }
    const codec = getAddressCodec();
    const tokenMintA = codec.decode(data.subarray(OFF_MINT_A, OFF_MINT_A + 32));
    const tokenMintB = codec.decode(data.subarray(OFF_MINT_B, OFF_MINT_B + 32));
    // The v1 swap instruction is legacy-SPL only; detect a Token-2022 mint (or
    // one carrying an un-routable extension) via the shared data-shape resolver
    // and SELF-DROP the pool. The thrown error is the graceful-drop signal — the
    // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue.
    // The LEGACY path stays byte-identical: a classic 82-byte mint classifies as
    // Tokenkeg, parses no extensions, and the config is built unchanged. An
    // unreadable mint falls back to the legacy assumption (keeps fixtures green).
    for (const mint of [tokenMintA, tokenMintB]) {
        const mintData = await load(mint);
        if (mintData === null)
            continue;
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
            programAddress: ORCA_WHIRLPOOL_PROGRAM_ID,
            seeds: [new TextEncoder().encode('oracle'), getAddressEncoded(pool)],
        }).then(([pda]) => pda),
    ]);
    return {
        venue: SLUG,
        pool,
        direction: 'aToB',
        tokenMintA,
        tokenMintB,
        tokenVaultA: codec.decode(data.subarray(OFF_VAULT_A, OFF_VAULT_A + 32)),
        tokenVaultB: codec.decode(data.subarray(OFF_VAULT_B, OFF_VAULT_B + 32)),
        oracle,
        tickSpacing,
        feeRate: Number(readUintLE(data, OFF_FEE_RATE, 2)),
        liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
        sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
        tickCurrentIndex,
        windows: { aToB, bToA },
    };
}
/**
 * Family facade for the recipe orchestrator (this venue is ladder-only — it
 * has no v1 SvmVenueAdapter and is not in the v1 registry).
 */
export const orcaWhirlpool = {
    slug: SLUG,
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM,
    fetchPoolConfig: fetchOrcaWhirlpoolConfig,
};
//# sourceMappingURL=index.js.map