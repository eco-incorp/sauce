/**
 * SolFi V2 venue adapter (program SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF) —
 * a push-quote PMM. The pool account stores an XOR-obfuscated 168-byte oracle
 * reference, an inventory-skew model and four spread splines; the closed-form
 * quote and the XOR keystream were recovered by disassembling the deployed
 * program (fn 0x26328 for the oracle parser, fn 0x22928/0x22808 for the
 * inventory skew, fn 0x202c0-0x20590 for the fee accumulator) and verified
 * wei-exact against 84+ landed `simulateTransaction` calls at real mainnet
 * state (see ladder.ts's module doc for the closed form and exactness notes).
 *
 * This file is the off-chain decode + CPI-account layer (PoolConfig,
 * fetchPoolConfig, quoteAccounts, the shared solfiSwapAccounts builder).
 *
 * ACCOUNT LIST is POSITIONAL BY MINT, not by direction (same trap as Quantum):
 * the swap ix always takes [userMintA, userMintB] in that fixed order,
 * regardless of which mint is being sold.
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
const SLUG = 'solfi-v2';
export const SOLFI_V2_PROGRAM_ID = address('SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
const POOL_ACCOUNT_SIZE = 1728;
const ORACLE_ACCOUNT_SIZE = 168;
const REGISTRY_ACCOUNT_SIZE = 1_048_576; // 1 MiB
// Pool account layout (fn boundaries: cfg reads at 0x5638-0x5a40, key checks at 0x54xx).
export const OFF_ORACLE = 24;
export const OFF_MINT_A = 56;
export const OFF_MINT_B = 88;
export const OFF_VAULT_A = 120;
export const OFF_VAULT_B = 152;
export const OFF_REGISTRY = 256;
// cfg = pool + 704 (fn 0x22928 / 0x202c0 base). Offsets below are ABSOLUTE
// (already cfg + N), matching the verified reference (crack/quote.mjs).
export const CFG = 704;
/** Four splines, stride 0x88 from CFG; d0/d1 select by TRADE DIRECTION (not stride order). */
export const OFF_SPLINE_D1 = CFG + 0x18; // used when dir === 1 (mintB -> mintA)
export const OFF_SPLINE_D0 = CFG + 0xa0; // used when dir === 0 (mintA -> mintB)
export const OFF_SPLINE_AGE = CFG + 0x128;
export const OFF_SPLINE_SF = CFG + 0x1b0;
export const OFF_CACHED_TS = CFG + 0x10;
export const OFF_SPREAD_DIR1 = CFG + 0x240; // u32, read when dir === 1
export const OFF_SPREAD_DIR0 = CFG + 0x244; // u32, read when dir === 0
export const OFF_THRESHOLD = CFG + 0x248; // u32, 0 => default 100
export const OFF_SKEW_NUM = CFG + 0x250; // i64
export const OFF_SKEW_DEN = CFG + 0x258; // i64
export const OFF_SKEW_HI = CFG + 0x260; // i64, assumed >= 0 (a "+hi" clamp bound)
export const OFF_SKEW_LO_MAG = CFG + 0x268; // i64, negated to form the "-lo" clamp bound
export const OFF_DECAY_PPM = CFG + 0x278; // i64
export const OFF_LAST_SWAP_SLOT = CFG + 0x288;
export const OFF_FEE_SCALE = CFG + 0x298; // u64, 1e6 | 1e5 observed
/** Spline struct: x[0..7] u64 @+0x00, y[0..7] u64 @+0x40, len u64 @+0x80. 136 bytes. */
export const SPLINE_X_STRIDE = 0x00;
export const SPLINE_Y_STRIDE = 0x40;
export const SPLINE_LEN_STRIDE = 0x80;
export const SPLINE_SIZE = 0x88;
// Oracle (168-byte XOR-obfuscated) plaintext word layout, after XOR-decode.
export const ORACLE_OFF_EXP = 0; // i64
export const ORACLE_OFF_MAN = 8; // u64
export const ORACLE_OFF_SLOT = 16; // u64 (publish slot)
export const ORACLE_OFF_TS = 24; // u64 (unix-ms; XOR key word is 0 -> already plaintext)
export const ORACLE_OFF_CONF = 32; // u64
export const ORACLE_OFF_EXPIRY_SLOT = 40; // u64
export const ORACLE_OFF_FEE_WORD = 56; // u64 holding two u32 halves (per-direction extra fee, 1e-7 units)
/**
 * 168-byte XOR keystream (21 u64 words), recovered from fn 0x26328
 * (0x26380-0x264a8 stores it as 21 immediates; XOR loop at 0x264c0-0x26518).
 * Word i covers plaintext bytes [8i, 8i+8). Only the words this adapter
 * actually reads are listed; word 3 (bytes 24..31, the ms timestamp) is
 * literally 0 — that field is plaintext in the raw account.
 */
export const ORACLE_KEY_WORDS = {
    0: 11029298117715798783n, // 0x990FF033CC55AAFF
    1: 4962160333955141990n, // 0x44DD228877EE1166
    2: 7407351566499993019n, // 0x66CC3300FFAA55BB
    3: 0n, // 0x0000000000000000
    4: 4938440133504497561n, // 0x4488DD22EE117799
    5: 11053579286710561365n, // 0x996633CC00FFAA55
    7: 17212138457273043063n, // 0xEEDDCCBBAA998877
};
/**
 * The one un-derived additive constant (units of 1e-7 impact), keyed by POOL —
 * see ladder.ts's module doc "residualRisk" for how it composes on-chain.
 *
 * FIXED (2026-07): this table used to be keyed by REGISTRY, not pool, on the
 * false premise that every pool sharing a registry shares its K. It does not:
 * registry QoFvFhDZg9TaZEi4SsasWpH5xXzk3zBqfRyicGexfNQ alone carries at least
 * two pools with DIFFERENT, independently-fitted K (K in [0, 12000] bisected
 * against drift-free bursts) — FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32
 * (USDT/USDC) needs K=0, 2Q6S8p9iZNzMvpTemiC56HqCJ3F3szNoyRkvqEKfCanY needs
 * K=5832 — and the old registry-keyed table quoted BOTH with 5832, so the
 * USDT pool was systematically wrong by 5832 units of 1e-7 impact (5.832 bps),
 * understating the true impact and so OVER-quoting the output by that amount
 * on every trade — not the "<=1 unit, always-safe" residual the old comment
 * claimed (that claim was true of ONE pool, 65ZHSArs..., and was written as if
 * venue-wide). fetchPoolConfig read the registry key blindly, admitting all
 * ~18 pools on that registry with an unverified, borrowed K.
 *
 * Fixed: keyed by POOL. A pool whose K has not been independently verified
 * throws at fetchPoolConfig instead of borrowing its registry-mate's value —
 * REFUSE, don't guess (see fetchPoolConfig below). Each entry below is
 * verified wei-exact against fresh mainnet `simulateTransaction` calls at
 * that SPECIFIC pool (65ZHSArs...: 84+ calls, 0 mismatch, within one
 * oracle-publish burst — see ladder.ts's module doc and solfi-v2.test.ts;
 * FkEB6uvy.../2Q6S8p9i...: bisected against drift-free bursts, K in
 * [0, 12000]).
 */
export const POOL_K = {
    '65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc': 1932n, // wSOL/USDC, registry FmxXDSR9...
    'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32': 0n, // USDT/USDC, registry QoFvFhDZ...
    '2Q6S8p9iZNzMvpTemiC56HqCJ3F3szNoyRkvqEKfCanY': 5832n, // registry QoFvFhDZ...
};
const codec = getAddressCodec();
const pubkeyAt = (data, offset) => codec.decode(data.subarray(offset, offset + 32));
function solfiConfig(cfg) {
    if (cfg.venue !== SLUG)
        throw new Error(`solfi-v2 adapter got a config for venue '${cfg.venue}'`);
    const c = cfg;
    if (c.direction !== 0 && c.direction !== 1)
        throw new Error(`solfi-v2 direction must be 0 or 1, got '${c.direction}'`);
    return c;
}
export const solfiV2 = {
    slug: SLUG,
    kind: 'constant-product',
    programId: SOLFI_V2_PROGRAM_ID,
    /**
     * Off-chain gate + decode. Rejects: wrong pool/oracle size, a pool whose
     * additive-impact constant K has never been independently verified (see
     * POOL_K — keyed by POOL, not registry: pools sharing a registry are NOT
     * guaranteed to share K, see POOL_K's header), and a missing
     * mint/oracle/registry account. direction is caller-supplied (0 or 1); both
     * directions share one pool account.
     */
    async fetchPoolConfig(load, pool, direction = 0) {
        const data = await load(pool);
        if (data === null)
            throw new Error(`solfi-v2 pool ${pool} account not found`);
        if (data.length !== POOL_ACCOUNT_SIZE) {
            throw new Error(`solfi-v2 pool ${pool} account is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
        }
        const oracle = pubkeyAt(data, OFF_ORACLE);
        const mintA = pubkeyAt(data, OFF_MINT_A);
        const mintB = pubkeyAt(data, OFF_MINT_B);
        const vaultA = pubkeyAt(data, OFF_VAULT_A);
        const vaultB = pubkeyAt(data, OFF_VAULT_B);
        const registry = pubkeyAt(data, OFF_REGISTRY);
        // The swap CPI is legacy-SPL (Tokenkeg) only for now, so SELF-DROP a pool
        // holding a Token-2022 mint (or an un-routable extension mint) — the thrown
        // error is the graceful-drop signal (SvmRoute drops the venue on a
        // fetchPoolConfig throw). An unreadable mint falls back to the legacy
        // assumption, keeping the byte-identical legacy path.
        for (const mint of [mintA, mintB]) {
            const mintData = await load(mint);
            if (mintData === null)
                continue;
            if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
                throw new Error(`solfi-v2: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
            }
            const { blocking } = parseMintExtensions(mintData);
            if (blocking.length > 0) {
                throw new Error(`solfi-v2: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
            }
        }
        const additiveK = POOL_K[pool];
        if (additiveK === undefined) {
            throw new Error(`solfi-v2 pool ${pool} has no independently-verified additive-impact constant K (resolved per POOL, not per registry — a registry-mate's K is never borrowed; see POOL_K)`);
        }
        const oracleData = await load(oracle);
        if (oracleData === null)
            throw new Error(`solfi-v2 pool ${pool} oracle ${oracle} account not found`);
        if (oracleData.length !== ORACLE_ACCOUNT_SIZE) {
            throw new Error(`solfi-v2 pool ${pool} oracle ${oracle} is ${oracleData.length} bytes, expected ${ORACLE_ACCOUNT_SIZE}`);
        }
        const registryData = await load(registry);
        if (registryData === null)
            throw new Error(`solfi-v2 pool ${pool} registry ${registry} account not found`);
        if (registryData.length !== REGISTRY_ACCOUNT_SIZE) {
            throw new Error(`solfi-v2 pool ${pool} registry ${registry} is ${registryData.length} bytes, expected ${REGISTRY_ACCOUNT_SIZE}`);
        }
        return {
            venue: SLUG,
            pool,
            direction,
            mintA,
            mintB,
            vaultA,
            vaultB,
            oracle,
            registry,
            tokenProgram: TOKEN_PROGRAM,
            additiveK,
        };
    },
    quoteAccounts(cfg) {
        const c = solfiConfig(cfg);
        return [
            { ref: c.pool, address: c.pool, writable: true },
            { ref: c.oracle, address: c.oracle },
            { ref: c.vaultA, address: c.vaultA },
            { ref: c.vaultB, address: c.vaultB },
        ];
    },
    /** v1 swap CPI (amount baked). disc(1) || amountIn u64 LE || minOut u64 LE=1 || direction u8. */
    buildSwap(cfg, user, amountIn) {
        const c = solfiConfig(cfg);
        const U64_MAX = (1n << 64n) - 1n;
        if (amountIn <= 0n || amountIn > U64_MAX)
            throw new Error(`solfi-v2 buildSwap amountIn must be a positive u64, got ${amountIn}`);
        const data = new Uint8Array(18);
        data[0] = 0x07;
        for (let b = 0; b < 8; b++)
            data[1 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
        data[9] = 1; // minOut = 1 (the recipe's terminal delta owns the bound)
        // bytes 10..16 (minOut high 7 bytes) already 0
        data[17] = c.direction;
        return {
            programId: SOLFI_V2_PROGRAM_ID,
            data,
            accounts: solfiSwapAccounts(c, user, (ref, addr, w) => fixed(ref, addr, w)),
        };
    },
};
const fixed = (ref, addr, writable) => writable ? { ref, address: addr, writable: true } : { ref, address: addr };
/**
 * The 13-account order for SolFi V2's swap (disc 0x07), shared by v1 buildSwap
 * and v2 buildSwapV2. Decoded from landed simulations, not docs (no IDL/docs
 * exist for this venue): [signer, pool, oracle, registry, vaultA, vaultB,
 * userA, userB, mintA, mintB, TOKEN, TOKEN (slot repeated), instructions
 * sysvar]. userA/userB are POSITIONAL BY MINT, never by direction.
 */
export function solfiSwapAccounts(c, user, make, refFor) {
    const r = refFor ?? ((role) => role);
    const aIsIn = c.direction === 0; // dir 0: mintA in / mintB out
    const userA = aIsIn ? user.inAta : user.outAta;
    const userB = aIsIn ? user.outAta : user.inAta;
    return [
        { ref: user.owner, signer: true, writable: true },
        make(r('pool'), c.pool, true),
        make(r('oracle'), c.oracle),
        make(r('registry'), c.registry, true),
        make(r('va'), c.vaultA, true),
        make(r('vb'), c.vaultB, true),
        { ref: userA, writable: true },
        { ref: userB, writable: true },
        make(r('ma'), c.mintA),
        make(r('mb'), c.mintB),
        make(r('tp'), c.tokenProgram),
        make(r('tp2'), c.tokenProgram),
        { ref: INSTRUCTIONS_SYSVAR },
    ];
}
/** Re-exported for the ladder mirror + tests (avoids a second copy of the offset table). */
export function readAccountU64(data, offset) {
    return readUintLE(data, offset, 8);
}
//# sourceMappingURL=index.js.map