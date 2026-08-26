/**
 * Quantum venue (QuaNtZsgYRe5Z9Bk4LZ4cTD9tbkVoyCNf1R2BN9bBDv) — a
 * PUSH-QUOTE PMM whose whole curve is a per-direction array of discrete
 * (price, size) LEVELS stored in PLAINTEXT in the pool account, each with its
 * own expiry slot. Ladder-only (adapter contract v2), like manifest: a quote
 * is a best-first walk over the levels, which does not fit the
 * one-adapter-one-pool v1 emitQuote shape.
 *
 * LAYOUT (source-verified by reversing the deployed .text and confirmed
 * against 27 live mainnet pools, all 2280 bytes; every integer u64 LE):
 *
 *   0    mint0            32   mint1            64  vault0        96  vault1
 *   128  reserve0 (u64)   136  reserve1 (u64)
 *   144  side0 struct  (784 bytes)     928  side1 struct  (784 bytes)
 *   0x6e0 dec0 (u8)  0x6e1 dec1 (u8)  0x6e3 levelCount (u8, BOTH sides)
 *
 *   side struct: levels[16] of { price u64, cum u64 } @+0 (16 bytes each),
 *                expirySlot[16] u64 @+256, kind[16] u8 @+384.
 *
 *   side1 (@928) serves token0-in/token1-out; side0 (@144) serves
 *   token1-in/token0-out. `cum` is the level's size in OUTPUT raw units;
 *   `price` is scaled so that input = out * price / 10^outDecimals.
 *   `expirySlot` is scaled by 1e4: a level is LIVE iff
 *   expirySlot / 10000 >= Clock::slot (a per-level gate, not a whole-pool
 *   revert — the venue simply SKIPS an expired level, .text 0x1058).
 *
 * QUOTE (the exact program, .text 0xd40 walk / 0x1558+0x1a00 full-level need /
 * 0x1ac8+0x1e30 partial / 0x20c0-0x2328 partial bisect / 0x10ad0 reserve gate):
 *
 *   n     = 10^decimals(outToken);  S2 = 2n
 *   pp_i  = price of level i-1 (level 0: its own price -> a flat first level).
 *           By ORIGINAL index, expired-or-not (0xfd0) — NOT the last live one.
 *   need_i = floor((pp_i + p_i) * c_i / S2)                 <- the TRAPEZOID
 *   walk: rem = amountIn; for each LIVE level i in order:
 *           if rem == 0: stop
 *           if rem >= need_i: out += c_i; rem -= need_i
 *           else:            out += maxFill(rem, i); stop
 *         if rem > 0 after the last level: the venue REVERTS (err 0xe).
 *   maxFill(rem, i) = max{ m in [0, c_i] : cost_i(m) <= rem }
 *   cost_i(m)       = floor((2*pp_i + floor((p_i - pp_i)*m / c_i)) * m / S2)
 *
 *   The inner floor is the venue's own (0x2168) — a LINEAR price ramp from
 *   pp_i at m=0 to p_i at m=c_i, i.e. a convex intra-level cost. The venue
 *   inverts it by bisection; ./ladder.ts inverts it with an exact 64-step
 *   binary-digit descent (same answer, static step count).
 *
 *   Then: out == 0 -> the venue reverts (err 0xd, a dust trade);
 *         out > min(reserveOut, outVault.amount) -> the venue reverts
 *         (err 0xe, .text 0x10ad0). Both are CAPACITY, not curve: the ladder
 *         SATURATES (see ladder.ts's capacityInputVar).
 *
 * A post-trade write-back (.text 0x10c50-0x110f8) bumps every level's price by
 * (1 + N/D) with D = 1e4*pool[0x6f0], N = pool[0x6e8]*amount + (amount >
 * pool[0x700] ? pool[0x6f8]*D/1e4 : 0) — a per-POOL impact constant set
 * (observed 1/1e8/5/5e6 and 1/3e8/1/5e6, never a program constant). It runs
 * AFTER the output is computed, so it never enters a quote; it is the reason a
 * second Quantum slot on the SAME pool in one cook would be mispriced (the
 * shape key is per-pool-per-direction, so that cannot happen).
 *
 * SHIPPED PREFIX. fetchPoolConfig freezes the maximal level prefix that is
 * walkable: it stops at the first level with price == 0 (a 0-price level after
 * a nonzero one makes the venue's own `p_i >= pp_i` gate REVERT, and a leading
 * one leaves the trapezoid's pp == 0) or a price DROP (same gate — one live
 * mainnet side has a sawtooth 100/300/100/... ladder that the venue itself
 * cannot walk past level 1). Levels with cum == 0 are no-ops and are kept in
 * place so the next level's prev-price index stays the venue's. Truncating is
 * a CAPACITY CLAMP, never an over-quote: the walk books no input for a level
 * it did not ship, so the venue never reaches one.
 *
 * AUTHORIZATION, deliberately NOT a gate here (sequence, not a blocker): the
 * swap instruction compares the transaction's OUTERMOST instruction program id
 * against a hardcoded list of 15 aggregator ids and returns Custom(9) at 656 CU
 * on no match. Sauce is not on that list today. The adapter is complete and
 * wei-exact regardless; whitelisting is an integration step, and the per-level
 * expiry is modeled as a SELF-DROP (skip the level) rather than a revert so a
 * stale ladder degrades instead of killing the cook.
 *
 * Gates (named errors; everything value-bearing stays a LIVE read):
 * - account size / program owner;
 * - non-classic-SPL mints (the swap is Tokenkeg-only here);
 * - a direction with no walkable level prefix (empty/parked ladder side).
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
import { address, getAddressCodec } from '@solana/kit';
import { readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'quantum';
export const QUANTUM_PROGRAM_ID = address('QuaNtZsgYRe5Z9Bk4LZ4cTD9tbkVoyCNf1R2BN9bBDv');
/**
 * The program's single global config account (one for every pool). Lived in
 * this venue's ladder module until the merge-decomposition ladders moved out;
 * it is a program address, not decomposition state, so it stays here.
 */
export const QUANTUM_GLOBAL = address('3JumrbigQRj9TqEuy5fKGPHsQ6zCTwqqfVGhFhyoEMqH');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** Exact pool account size (all 27 live mainnet pools). */
export const QUANTUM_POOL_SIZE = 2280;
// Pool offsets.
export const OFF_MINT0 = 0;
export const OFF_MINT1 = 32;
export const OFF_VAULT0 = 64;
export const OFF_VAULT1 = 96;
export const OFF_RESERVE0 = 128;
export const OFF_RESERVE1 = 136;
export const OFF_SIDE0 = 144;
export const OFF_SIDE1 = 928;
export const OFF_DEC0 = 0x6e0;
export const OFF_DEC1 = 0x6e1;
export const OFF_LEVEL_COUNT = 0x6e3;
// Side-struct relative offsets.
export const SIDE_LEVELS = 0;
export const SIDE_LEVEL_STRIDE = 16;
export const SIDE_EXPIRY = 256;
export const SIDE_KINDS = 384;
/** Hard array bound inside a side struct (the venue's own index guard is < 17). */
export const QUANTUM_LEVEL_SLOTS = 16;
/** expirySlot is stored scaled by 1e4; the venue divides before comparing (.text 0x1058). */
export const EXPIRY_SCALE = 10000n;
/**
 * Shipped levels per direction. 16 is the venue's own array bound; all but 5
 * of the 27 live pools publish 5. The walk is a bounded loop (not unrolled),
 * so this costs three 16-entry arrays of slot locals, not 16x the fragment.
 */
export const QUANTUM_MAX_LEVELS = 16;
/** Level kinds the fragment implements: 1 = trapezoid (every live pool side). */
export const QUANTUM_KIND_TRAPEZOID = 1;
/** Side-struct base offset for a direction (zeroIn reads side1, oneIn reads side0). */
export function quantumSideBase(direction) {
    return direction === 'zeroIn' ? OFF_SIDE1 : OFF_SIDE0;
}
/** 10^decimals of the direction's OUTPUT token. */
export function quantumOutScale(cfg) {
    return 10n ** BigInt(cfg.direction === 'zeroIn' ? cfg.dec1 : cfg.dec0);
}
/** The direction's output vault (whose live balance is the hard out cap). */
export function quantumOutVault(cfg) {
    return cfg.direction === 'zeroIn' ? cfg.vault1 : cfg.vault0;
}
/** The direction's input vault (the swap CPI's transfer destination). */
export function quantumInVault(cfg) {
    return cfg.direction === 'zeroIn' ? cfg.vault0 : cfg.vault1;
}
/** Cached out-reserve offset for the direction (the second half of the out cap). */
export function quantumOutReserveOffset(cfg) {
    return cfg.direction === 'zeroIn' ? OFF_RESERVE1 : OFF_RESERVE0;
}
const levelPrice = (data, side, i) => readUintLE(data, side + SIDE_LEVELS + i * SIDE_LEVEL_STRIDE, 8);
const levelCum = (data, side, i) => readUintLE(data, side + SIDE_LEVELS + i * SIDE_LEVEL_STRIDE + 8, 8);
/**
 * Freeze the walkable level prefix of one side. See the header's SHIPPED
 * PREFIX: stop at price == 0, at a price DROP, at a non-trapezoid kind, and at
 * QUANTUM_MAX_LEVELS. cum == 0 levels are kept (no-op walk steps) so the next
 * level's prev-price index stays the venue's.
 */
function resolveWindow(data, side, count) {
    const levels = [];
    const bound = Math.min(count, QUANTUM_LEVEL_SLOTS, QUANTUM_MAX_LEVELS);
    for (let i = 0; i < bound; i++) {
        const price = levelPrice(data, side, i);
        const prev = levelPrice(data, side, Math.max(0, i - 1));
        if (price === 0n || prev === 0n || price < prev)
            break;
        if (data[side + SIDE_KINDS + i] !== QUANTUM_KIND_TRAPEZOID)
            break;
        levels.push({ index: i });
    }
    // Trailing cum == 0 levels contribute nothing; drop them so an all-no-op
    // prefix reports as empty (the orchestrator's "no shippable level" gate).
    while (levels.length > 0 && levelCum(data, side, levels[levels.length - 1].index) === 0n)
        levels.pop();
    return { levels };
}
/**
 * Fetch + gate one Quantum pool and freeze both directions' walkable level
 * prefixes. Read-only against the loader.
 */
export async function fetchQuantumConfig(load, pool) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`${SLUG}: pool account ${pool} not found`);
    if (data.length !== QUANTUM_POOL_SIZE) {
        throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected ${QUANTUM_POOL_SIZE}`);
    }
    const codec = getAddressCodec();
    const mint0 = codec.decode(data.subarray(OFF_MINT0, OFF_MINT0 + 32));
    const mint1 = codec.decode(data.subarray(OFF_MINT1, OFF_MINT1 + 32));
    // The swap ix is Tokenkeg-only here. Detect the real token program per mint
    // via the shared data-shape resolver and SELF-DROP a Token-2022 mint or one
    // carrying an un-routable extension (the thrown error IS the graceful drop —
    // SvmRoute catches a fetchPoolConfig throw and drops the venue). LEGACY path
    // byte-identical: a classic 82-byte mint classifies Tokenkeg, parses no
    // extensions, config built unchanged. An unreadable mint falls back to the
    // legacy assumption (keeps fixture-only tests green).
    const mints = [mint0, mint1];
    const mintDatas = await Promise.all(mints.map((mint) => load(mint)));
    for (let mi = 0; mi < mints.length; mi++) {
        const mint = mints[mi];
        const mintData = mintDatas[mi];
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
    const levelCount = data[OFF_LEVEL_COUNT];
    if (levelCount === 0 || levelCount > QUANTUM_LEVEL_SLOTS) {
        throw new Error(`${SLUG}: pool ${pool} declares ${levelCount} levels (expected 1..${QUANTUM_LEVEL_SLOTS})`);
    }
    return {
        venue: SLUG,
        pool,
        direction: 'zeroIn',
        mint0,
        mint1,
        vault0: codec.decode(data.subarray(OFF_VAULT0, OFF_VAULT0 + 32)),
        vault1: codec.decode(data.subarray(OFF_VAULT1, OFF_VAULT1 + 32)),
        dec0: data[OFF_DEC0],
        dec1: data[OFF_DEC1],
        levelCount,
        windows: {
            zeroIn: resolveWindow(data, OFF_SIDE1, levelCount),
            oneIn: resolveWindow(data, OFF_SIDE0, levelCount),
        },
    };
}
/** Family facade for the recipe orchestrator (ladder-only — not in the v1 registry). */
export const quantum = {
    slug: SLUG,
    programId: QUANTUM_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM,
    fetchPoolConfig: fetchQuantumConfig,
};
//# sourceMappingURL=index.js.map