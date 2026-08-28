/**
 * `@eco-incorp/sauce-sdk`'s `swap` module — E4.1, the universal swap adapter.
 *
 * Types + pool-type registry for lowering a chain-agnostic swap SPEC into a `ISauceRouter.swap`
 * call. See `sdk/src/swap/index.ts` for the module-level overview and the E3 composition example.
 */
/**
 * `SwapPoolType` — pinned verbatim from the engine's `IRouter.sol` `enum SwapPoolType`, whose own
 * doc says values are APPEND-ONLY (the enum rides `SwapParams.poolType` as `uint8`, so reordering
 * breaks the ABI of every compiled recipe). Only 0..8 are dispatchable through the unified
 * `swap()` entry point — see {@link UndispatchablePoolType} for 9/10.
 */
export const SwapPoolType = {
    UniV2: 0,
    UniV3: 1,
    UniV4: 2,
    Curve: 3,
    BalancerV2: 4,
    DODOV2: 5,
    TraderJoeLB: 6,
    MaverickV2: 7,
    WOOFi: 8,
};
/**
 * Pool types that exist on the engine's `SwapPoolType` enum but are NOT dispatchable through the
 * unified `swap()` — `Router.sol`'s `swap()` dispatch chain covers only 0..8 and falls through to
 * `revert SwapFailed()` for anything else. PancakeInfinity's CL/Bin pools need their own
 * `swapInfinityCL`/`swapInfinityBin` entry points (a different, 6-field `InfinityPoolKey` that
 * `SwapParams` cannot carry) — out of scope for this first cut. Exported so the value is nameable;
 * {@link toSwapParams} throws when handed one of these, pointing at this follow-up.
 */
export const UndispatchablePoolType = {
    PancakeInfinityCL: 9,
    PancakeInfinityBin: 10,
};
const CALLBACK_VENUES = new Set([
    SwapPoolType.UniV3,
    SwapPoolType.UniV4,
    SwapPoolType.MaverickV2,
]);
const CALLBACK_FREE_VENUES = new Set([
    SwapPoolType.UniV2,
    SwapPoolType.Curve,
    SwapPoolType.BalancerV2,
    SwapPoolType.DODOV2,
    SwapPoolType.TraderJoeLB,
    SwapPoolType.WOOFi,
]);
/**
 * True for the three pool types `Router.sol` (`~279-283`) allows a non-empty `callback` for — the
 * pool re-enters the contract mid-swap to pull input, so servicing it requires the router's
 * compiled code. NOT the same partition as {@link isCallbackFree}: MaverickV2 is callback-driven
 * yet its handler still takes `abs(amountSpecified)` (see `amountSpecifiedFor`).
 */
export function isCallbackVenue(poolType) {
    return CALLBACK_VENUES.has(poolType);
}
/**
 * True for the pool types whose swap logic is callback-free (`Router.sol` reads reserves / calls a
 * plain `pool.swap(...)`) and so MAY, as a follow-up, be replicated as direct
 * `transfer` + `pool.swap` SauceScript instead of going through the Router. This module always
 * routes through the unified `swap()` regardless — see `sdk/src/swap/index.ts`'s scope notes.
 */
export function isCallbackFree(poolType) {
    return CALLBACK_FREE_VENUES.has(poolType);
}
/**
 * True for the pool types where `SwapParams.poolKey` is actually consulted by the engine:
 * UniV4 (all 5 fields, via `V4SwapParams`) and, less obviously, UniV2 (`Router.sol#_swapV2` reads
 * `poolKey.fee` as the pair's LP fee in ppm — `0` defaults to 3000 / 0.30%, `>= 1_000_000` reverts).
 * Every other pool type ignores `poolKey` entirely.
 */
export function usesPoolKey(poolType) {
    return poolType === SwapPoolType.UniV4 || poolType === SwapPoolType.UniV2;
}
/** All-zero `poolKey`, used for any pool type that doesn't consult it (see {@link usesPoolKey}). */
export const ZERO_POOL_KEY = {
    currency0: 0n,
    currency1: 0n,
    fee: 0n,
    tickSpacing: 0n,
    hooks: 0n,
};
/** `SwapParams`'s top-level field names, in exact ABI-declaration order (pinned against the
 *  vendored `ISauceRouter.json` artifact in `sdk/test/swap.test.ts`). */
export const SWAP_PARAMS_FIELDS = [
    "poolType",
    "pool",
    "poolKey",
    "tokenIn",
    "tokenOut",
    "amountSpecified",
    "sqrtPriceLimitX96",
    "payer",
    "recipient",
    "callback",
];
/** `SwapParams.poolKey`'s field names, in exact ABI-declaration order. */
export const POOL_KEY_FIELDS = [
    "currency0",
    "currency1",
    "fee",
    "tickSpacing",
    "hooks",
];
//# sourceMappingURL=types.js.map