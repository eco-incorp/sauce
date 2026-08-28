/**
 * Normalization core for E4.1's universal swap adapter — `toSwapParams` + `amountSpecifiedFor`.
 * See `sdk/src/swap/index.ts` for the module overview.
 */
import { SwapPoolType, type SwapParams, type SwapSpec } from "./types.js";
/**
 * The single, standalone sign rule (E4.3): given a POSITIVE exact-input amount, returns the
 * `amountSpecified` value the given pool type's handler actually wants.
 *
 * - UniV3 (`Router.sol:431`, passthrough into Uniswap V3's own `pool.swap`): POSITIVE = exact
 *   input (fork-verified; contradicts `IRouter.sol`'s own struct doc comment — see `SwapParams`).
 * - UniV4 (`Router.sol`'s `unlockCallback` → `V4SwapParams`): NEGATIVE = exact input (Uniswap V4's
 *   flipped convention). Encoded as the exact two's-complement `uint256` (`2**256 - amountIn`), not
 *   `-amountIn` — see the module doc for why the compact spelling is deliberately deferred.
 * - Every other pool type (0, 3, 4, 5, 6, 7, 8): the handler takes `abs(amountSpecified)`, so the
 *   canonical positive form is used as-is.
 */
export declare function amountSpecifiedFor(poolType: SwapPoolType, amountIn: bigint): bigint;
/**
 * The whole normalization + sign + defaulting + guard decision: lowers a chain-agnostic
 * {@link SwapSpec} into a fully normalized {@link SwapParams} — plain bigints (+ the `"self"`
 * sentinel for a defaulted `payer`/`recipient`), in exact ABI-declaration order, so
 * `Object.keys(toSwapParams(spec))` matches the vendored `ISauceRouter.json` component order.
 *
 * Throws (never emits a program that would revert on-chain) for: poolType 9/10 (Infinity — not
 * dispatchable through `swap()`, see {@link UndispatchablePoolType}); any other out-of-range
 * poolType; UniV4 missing `poolKey`; UniV2 `poolKey.fee >= 1_000_000`; a non-empty `callback` on a
 * non-callback-driven pool type; a non-empty `callback` with an overridden `payer`/`recipient`.
 */
export declare function toSwapParams(spec: SwapSpec): SwapParams;
//# sourceMappingURL=params.d.ts.map