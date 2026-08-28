import type { Address } from '@solana/kit';
export declare const STABLE_SWAP_PROGRAM_ID: Address<"swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ">;
export declare const WEIGHTED_SWAP_PROGRAM_ID: Address<"swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW">;
export declare const STABBLE_VAULT_PROGRAM_ID: Address<"vo1tWgqZMjG61Z2T9qUaMYKqZ75CYzMuaZ2LZP1n7HV">;
export declare const STABBLE_TOKEN_PROGRAM_ID: Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
export declare const STABBLE_TOKEN_2022_PROGRAM_ID: Address<"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb">;
export declare const STABBLE_ATA_PROGRAM_ID: Address<"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL">;
/** sha256("account:Pool")[..8] — shared by BOTH variants (Anchor discriminators are name-, not program-, keyed; verified against live pool accounts of both programs). */
export declare const STABBLE_POOL_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
/** sha256("account:Vault")[..8]. */
export declare const STABBLE_VAULT_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
/** sha256("global:swap")[..8] — the v1 `swap(amount_in: Option<u64>, minimum_amount_out: u64)` entry point. */
export declare const STABBLE_SWAP_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
export declare const STABBLE_ONE = 1000000000n;
declare const U64_MAX: bigint;
/** floor(a*n/d) — the engine's DIV rule (a zero divisor yields 0, never throws), matched here for parity with the on-chain fragment. */
export declare function mulDivDown(a: bigint, n: bigint, d: bigint): bigint;
/** ceil(a*n/d), 0 on a zero divisor (engine DIV-rule parity). */
export declare function mulDivUp(a: bigint, n: bigint, d: bigint): bigint;
/** ceil(a/d), 0 on a zero divisor (engine DIV-rule parity). */
export declare function divUpRaw(a: bigint, d: bigint): bigint;
export declare function mulDown(a: bigint, b: bigint): bigint;
export declare function mulUp(a: bigint, b: bigint): bigint;
export declare function divDown(a: bigint, b: bigint): bigint;
export declare function divUp(a: bigint, b: bigint): bigint;
export declare function complement(a: bigint): bigint;
export interface StabbleTokenScale {
    scalingUp: boolean;
    scalingFactor: bigint;
}
export declare function calcWrappedAmount(amount: bigint, token: StabbleTokenScale): bigint;
export declare function calcUnwrappedAmount(amount: bigint, token: StabbleTokenScale): bigint;
export declare function calcRoundedAmount(amount: bigint, token: StabbleTokenScale): bigint;
export interface StabblePoolTokenBase {
    mint: Address;
    decimals: number;
    scalingUp: boolean;
    scalingFactor: bigint;
    balance: bigint;
}
export interface StabbleVaultInfo {
    admin: Address;
    withdrawAuthority: Address;
    withdrawAuthorityBump: number;
    authorityBump: number;
    isActive: boolean;
    beneficiary: Address;
    beneficiaryFee: bigint;
}
export declare function decodeStabbleVault(pool: Address, data: Uint8Array | null): StabbleVaultInfo;
export declare function decodeStabblePoolCommon(pool: Address, data: Uint8Array | null, programLabel: string, tokensOffset: number, tokenSize: number, weighted: boolean, minLength: number): {
    vault: Address<string>;
    mint: Address<string>;
    authorityBump: number;
    isActive: boolean;
    tokens: (StabblePoolTokenBase & {
        weight?: bigint;
    })[];
};
/**
 * sha256(seeds... || programId || "ProgramDerivedAddress") — the raw
 * create_program_address with a KNOWN bump (never find_program_address:
 * would be wrong if the stored bump isn't the canonical one, and here it's
 * always read straight off the Vault account, never searched).
 */
export declare function createProgramAddress(seeds: Uint8Array[], programId: Address): Address;
/** vault_authority = create_program_address(["vault_authority", vault, [bump]], VAULT_PROGRAM_ID) — verified against live mainnet vaults. */
export declare function deriveStabbleVaultAuthority(vault: Address, authorityBump: number): Address;
/** Canonical ATA(owner, mint) under the classic SPL Token program — a real find_program_address (off-curve search), needed once per pool at fetch time. */
export declare function findStabbleAta(owner: Address, mint: Address): Promise<Address>;
declare function assertU64AmountIn(amountIn: bigint, label: string): void;
export { assertU64AmountIn as assertStabbleU64AmountIn, U64_MAX as STABBLE_U64_MAX };
export declare const STABLE_AMP_PRECISION = 1000n;
export declare const STABLE_MIN_TOKENS = 2;
export declare const STABLE_MAX_TOKENS = 5;
/** calc_invariant — Newton-Raphson D, <=64 rounds, converged when |D - Dprev| <= 100 (NOT 1 — Stabble's own default threshold, distinct from the 2-coin curve's threshold of 1). */
export declare function stableCalcInvariantN(amplification: bigint, balances: readonly bigint[]): bigint;
/** get_token_balance_given_invariant_n_all_other_balances — cold start (the venue's own initial guess), see stableSolveY for the shared Newton loop. */
export declare function stableGetBalanceGivenInvariant(amplification: bigint, balances: readonly bigint[], invariant: bigint, excludedBalance: bigint): bigint;
/** Ladder warm-start variant: same Newton recursion, starting from a caller-supplied y0 (the previous rung's converged y) instead of the cold initial guess. Passing y0 = invariant reproduces the cold start exactly. */
export declare function stableGetBalanceGivenInvariantWarm(amplification: bigint, balances: readonly bigint[], invariant: bigint, excludedBalance: bigint, y0: bigint): bigint;
/** calc_out_given_in — the exact-in quote (wrapped units, no fee applied yet). Returns 0 (not throw) on a degenerate/dust input the venue's own checked_sub would fail on, matching the engine's div-by-zero-yields-0 convention used throughout this codebase for quote fragments. */
export declare function stableCalcOutGivenIn(amplification: bigint, balances: readonly bigint[], tokenIndexIn: number, tokenIndexOut: number, amountIn: bigint, invariant: bigint): bigint;
/** get_amplification: linear ramp interpolation, clamped at the ramp window's ends (60s-quantized elapsed, matching the on-chain `checked_div(60)?.checked_mul(60)?`). */
export declare function stableGetAmplification(ampInitialFactor: number, ampTargetFactor: number, rampStartTs: bigint, rampStopTs: bigint, currentTs: bigint): bigint;
/**
 * SauceScript SOURCE for a self-contained N-token stable quote helper, FIXED
 * to tokenIndexIn=0, tokenIndexOut=1 (this repo's declared AtoB-only scope —
 * see stabble-stable-swap's module doc). One helper per N (2..5); the ladder
 * dedupes by name, so every pool sharing an N reuses the identical source
 * (the `helpers()` dedupe invariant in ../types.js).
 *
 * A line-for-line transliteration of `stableCalcInvariantN` +
 * `stableGetBalanceGivenInvariant` + `stableCalcOutGivenIn` above (see those
 * for the bit-exact-verified bigint reference this mirrors): D-Newton
 * (<=64 rounds, converge |Δ|<=100) then the excluded-balance Y-Newton
 * (<=64 rounds, converge |Δ|<=1), both COLD (no cross-rung warm-start — the
 * ladder calls this fresh per rung/final quote; see the ladder's module doc
 * for why that tradeoff was made). Ceiling divisions (`checked_mul_div_up`/
 * `checked_div_up` in the Rust source) are emitted as plain
 * `(num + den - 1) / den` — safe without Math.mulDiv's 512-bit path because
 * every product here stays far below 256 bits for realistic pool
 * magnitudes (MAX_SAFE_BALANCE = 3e18 ~ 2^62; D and its square stay under
 * ~2^130, AMP_PRECISION-scaled terms add a handful more bits) — bounds
 * documented in docs/svm-venues.md-style fashion inline below is skipped
 * only because this module doc already states them once for the whole file.
 * A zero divisor anywhere (an empty side) yields 0 (the engine's DIV rule),
 * never a revert — matched here so a degenerate pool quotes 0 instead of
 * poisoning the merge.
 */
/**
 * SauceScript SOURCE for the N-token D-Newton ALONE (calc_invariant) — the
 * ladder's warm-start split of `stableQuoteHelperSource`: an N-token pool's
 * D depends only on the reserves, so it is computed ONCE per trade (in
 * `emitSetup`), not once per rung. Same <=64 rounds / converge |Δ|<=100 as
 * the combined helper; see that function's doc for the ceiling-division and
 * zero-divisor conventions (identical here).
 */
export declare function stableDHelperSource(n: number): {
    name: string;
    source: string;
};
/**
 * SauceScript SOURCE for the excluded-balance Y-Newton ALONE, WARM-STARTABLE
 * from a caller-supplied `y0` (the ladder's warm-start split of
 * `stableQuoteHelperSource`): identical math to
 * `stableGetBalanceGivenInvariant` EXCEPT the cold initial-guess formula is
 * replaced by the caller's `y0` — passing `y0 = d` (the venue's own cold
 * start) reproduces the venue-exact final quote; a ladder thread the
 * PREVIOUS rung's converged y instead, cutting iterations to ~1-2 (a larger
 * cumulative input means a smaller y, so the previous rung's y still
 * approaches the fixed point from above — exactly `stableYW`'s justification
 * for the 2-coin case, unchanged by generalizing to N tokens). Same
 * ceiling-division / zero-divisor conventions as `stableQuoteHelperSource`.
 */
export declare function stableYWarmHelperSource(n: number): {
    name: string;
    source: string;
};
export declare function stableQuoteHelperSource(n: number): {
    name: string;
    source: string;
};
export declare const WEIGHTED_MAX_IN_RATIO = 300000000n;
export declare const WEIGHTED_MIN_TOKENS = 2;
export declare const WEIGHTED_MAX_TOKENS = 4;
/**
 * Integer floor(sqrt(n)), Newton's method. Exported (like every other helper
 * in this module) so its byte-identity and iteration count are directly
 * testable — see stabble-isqrt.test.ts.
 *
 * The seed `1n << ceil(bits/2)` (bits = n's bit length) is picked so the
 * FIRST iterate already sits >= floor(sqrt(n)) for every n >= 2: n < 2^bits
 * implies sqrt(n) < 2^(bits/2) <= 2^ceil(bits/2), so the seed's square,
 * 2^(2*ceil(bits/2)), is >= 2^bits > n. Newton's iteration for floor-sqrt is
 * monotonically non-increasing once started at or above the true root and
 * converges to exactly floor(sqrt(n)) regardless of the starting point (the
 * classical property this loop has always relied on — only the seed changed
 * here) — so the RESULT for every n is unchanged; only the number of
 * iterations needed drops, from ~bits/2 with the old `x = n` seed (each
 * early iteration barely halves x) to ~5-8 total once seeded this close to
 * the root. This matters here specifically because `weightedPowUp`'s
 * fractional-exponent path feeds `sqrtInternalCeil` an ISCALE(1e18)-inflated
 * operand — routinely ~110-130 bits — so the old seed cost ~55-70 slow
 * halving iterations per sqrt call, repeated up to POW_FRAC_BITS(64) times
 * per `weightedPowUp` invocation.
 */
export declare function isqrtFloor(n: bigint): bigint;
/** OVER-estimate of base^exponent (base in (0, ONE], exponent >= 0, both ONE(1e9)-scaled). */
export declare function weightedPowUp(base: bigint, exponent: bigint): bigint;
/** calc_out_given_in (wrapped units) — null (not throw) once amountIn exceeds MAX_IN_RATIO, the venue's real hard capacity cap (`None` on-chain, would panic the instruction; the ladder must clamp to this, never quote past it). */
export declare function weightedCalcOutGivenIn(balanceIn: bigint, weightIn: bigint, balanceOut: bigint, weightOut: bigint, amountIn: bigint): bigint | null;
/**
 * SauceScript SOURCE mirror of `weightedPowUp` — since `weightIn`/`weightOut`
 * are pool constants (immutable in practice; treated as such here, matching
 * this codebase's convention of baking genuinely-immutable curve constants),
 * the exponent — and therefore the ENTIRE bit-decomposition schedule (how
 * many squarings for the integer part, how many sqrt iterations for the
 * fraction, and which of them land a "multiply into result" — is fully
 * determined at COMPILE TIME. So unlike the runtime loop `weightedPowUp`
 * runs in TS, the emitted fragment needs NO loop and NO data-dependent
 * branch at all: this function TRACES the same schedule off-chain and
 * emits a flat, unrolled sequence of ceiling-sqrt/ceiling-multiply lines —
 * cheaper AND simpler than a generic runtime loop, and naturally short for
 * "nice" ratios (50/50, 80/20, ...) since the fractional remainder can hit
 * exactly 0 after only 1-2 iterations. `baseVar` must already be bound to
 * the ONE(1e9)-scaled runtime base (`divUp(balanceIn, balanceIn+amountIn)`);
 * `out` becomes a `const` holding the ONE-scaled, ceiling-biased power.
 * The three exact-integer special cases (ONE/TWO/THREE/FOUR) reproduce the
 * real program's own fast path bit-for-bit (mulUp composition, no
 * approximation); everything else uses the conservative sqrt ladder (see
 * `weightedPowUp`'s doc for the accuracy/conservatism proof).
 */
export declare function weightedPowUpSource(weightIn: bigint, weightOut: bigint, baseVar: string, out: string): string[];
/**
 * Full weighted-swap core quote (wrapped-space, NO fee applied yet — the
 * caller applies swap_fee, matching the real program's own function
 * boundary): `${outVar}` becomes the wrapped gross output for a wrapped
 * gross-input expression `wrappedXExpr` (0 when the expression is 0, never
 * negative, never throws on a zero/degenerate denominator — matches the
 * engine's DIV rule). `tag` must be unique per call site (rung index or
 * "final") so nested locals across multiple emissions in one fragment don't
 * collide.
 */
export declare function weightedCoreQuoteLines(tag: string, balInVar: string, balOutVar: string, weightIn: bigint, weightOut: bigint, wrappedXExpr: string, outVar: string): string[];
//# sourceMappingURL=stabble-common.d.ts.map