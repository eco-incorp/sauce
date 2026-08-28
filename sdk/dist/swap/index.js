/**
 * `@eco-incorp/sauce-sdk`'s `swap` module — E4.1, the universal swap adapter.
 *
 * Lowers a chain-agnostic swap SPEC into the call(s) that execute it through the Sauce Router's
 * unified `swap(SwapParams)` entry point, keyed by `SwapPoolType`. Two layers, both pure/sync, no
 * compiler import (mirrors `sdk/src/recipes/index.ts`'s "every compile option stays explicit at the
 * call site" posture):
 *
 *   1. {@link toSwapParams} — the whole normalization/sign/defaulting/guard decision, as a plain
 *      `SwapParams` object (bigint scalars, exact ABI-declaration order). Independently useful for
 *      an off-chain `viem.encodeFunctionData` call (e.g. a `quote()` simulation) or a test assertion.
 *   2. {@link swapCallStatement} / {@link swapSource} — pure string templating over that object,
 *      producing SauceScript source. `swapSource` returns a complete `function main() { ... }`
 *      program; `swapCallStatement` returns one bare statement for splicing into a larger program.
 *
 * ## Composing with E3 (route.calls)
 *
 * ```ts
 * import { compile } from "@eco-incorp/sauce-sdk/compiler";
 * import { swap, routes } from "@eco-incorp/sauce-sdk";
 * import { bytesToHex } from "viem";
 *
 * const { bytecode } = compile(swap.swapSource(spec), {
 *   baseDirs: swap.SWAP_BASE_DIRS,   // resolves ./artifacts/ISauceRouter.json (+ IERC20 if needed)
 *   target: "v12",
 *   treeshake: true,
 *   tsSource: true,
 * });
 *
 * const call = routes.buildSauceEvmCall({ pot, ingredients: [bytesToHex(bytecode[0])] });
 * // -> CallInput; drops straight into RouteInput.calls, flows through normalizeRoute/encodeRouteEvm.
 * ```
 *
 * A v12 program's `swap()` call self-targets `address.self` (Router entries are `onlySelf`); the
 * V12Pot's own `fallback` delegatecalls it into the v1 Router — see `V12Pot.sol`'s own header for
 * that mechanism. This module never rebuilds any of that seam, only emits the SauceScript that
 * exercises it.
 *
 * **One cook = one program** (`V12Pot.cook` executes `ingredients[0]` only): a multi-hop route is
 * ONE `swapSource([legA, legB, ...])` program with N sequential `swap()` statements, not N cooks. A
 * swap-then-settle composition is two separate `CallInput`s — `routes.buildSauceEvmCalls({ pot,
 * cooks: [[swapBlob], [settleBlob]] })`.
 *
 * ## Scope (this is a minimal first cut)
 *
 * - **Unified `swap()` only — poolType 0..8.** PancakeInfinity's CL/Bin pools (9/10) are not
 *   dispatchable through `swap()` at all (`Router.sol` falls through to `revert SwapFailed()`); they
 *   need their own `swapInfinityCL`/`swapInfinityBin` emitters and their own (NEGATIVE-required)
 *   sign rule. `toSwapParams` throws a named error pointing here rather than emitting a program that
 *   reverts on-chain. See {@link UndispatchablePoolType}.
 * - **No deposit/stake/wrap/bridge (E4.2).** Those lower to direct `approve` + per-protocol calls
 *   against the SDK's protocol registry — a different shape (a registry, not one entry point).
 * - **No callback-free direct-SauceScript alternative.** V2/Curve/BalancerV2/DODOV2/TraderJoeLB/
 *   WOOFi (see {@link isCallbackFree}) MAY be replicated as `transfer` + `pool.swap` SauceScript,
 *   bypassing the Router's fallback-delegatecall hop — this module always routes through the
 *   unified `swap()` for all nine dispatchable types uniformly. Deferred; the predicate is exported
 *   now so the follow-up has it.
 * - **No Tier-1 flash-fragment construction.** `spec.callback` is accepted and guarded (see
 *   {@link isCallbackVenue}) but never built — it is an opaque, already-compiled program the caller
 *   supplies.
 * - **No return-value decoding.** `swap()`'s `(int256 amount0, int256 amount1)` is emitted as a bare
 *   discarded call; recovering `amountOut` needs direction-dependent delta selection. The intended
 *   composition is `swap` cook → `settle.sauce.ts` cook, whose `minOut` floor is the real output
 *   guard.
 * - **EVM/v12 only**, same posture as `sdk/src/recipes/`. The Sauce Router itself is EVM-only.
 *
 * See `docs/plans/2026-08-08-universal-interfaces-epic.md` for the wider epic this is E4.1 of.
 */
export { SwapPoolType, UndispatchablePoolType, ZERO_POOL_KEY, SWAP_PARAMS_FIELDS, POOL_KEY_FIELDS, isCallbackVenue, isCallbackFree, usesPoolKey, } from "./types.js";
export { toSwapParams, amountSpecifiedFor } from "./params.js";
export { swapCallStatement, swapSource, swapImportLines, SWAP_BASE_DIRS } from "./source.js";
//# sourceMappingURL=index.js.map