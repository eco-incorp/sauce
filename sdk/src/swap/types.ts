/**
 * `@eco-incorp/sauce`'s `swap` module — E4.1, the universal swap adapter.
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
} as const;

export type SwapPoolType = (typeof SwapPoolType)[keyof typeof SwapPoolType];

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
} as const;

export type UndispatchablePoolType =
  (typeof UndispatchablePoolType)[keyof typeof UndispatchablePoolType];

const CALLBACK_VENUES: ReadonlySet<SwapPoolType> = new Set([
  SwapPoolType.UniV3,
  SwapPoolType.UniV4,
  SwapPoolType.MaverickV2,
]);

const CALLBACK_FREE_VENUES: ReadonlySet<SwapPoolType> = new Set([
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
export function isCallbackVenue(poolType: SwapPoolType): boolean {
  return CALLBACK_VENUES.has(poolType);
}

/**
 * True for the pool types whose swap logic is callback-free (`Router.sol` reads reserves / calls a
 * plain `pool.swap(...)`) and so MAY, as a follow-up, be replicated as direct
 * `transfer` + `pool.swap` SauceScript instead of going through the Router. This module always
 * routes through the unified `swap()` regardless — see `sdk/src/swap/index.ts`'s scope notes.
 */
export function isCallbackFree(poolType: SwapPoolType): boolean {
  return CALLBACK_FREE_VENUES.has(poolType);
}

/**
 * True for the pool types where `SwapParams.poolKey` is actually consulted by the engine:
 * UniV4 (all 5 fields, via `V4SwapParams`) and, less obviously, UniV2 (`Router.sol#_swapV2` reads
 * `poolKey.fee` as the pair's LP fee in ppm — `0` defaults to 3000 / 0.30%, `>= 1_000_000` reverts).
 * Every other pool type ignores `poolKey` entirely.
 */
export function usesPoolKey(poolType: SwapPoolType): boolean {
  return poolType === SwapPoolType.UniV4 || poolType === SwapPoolType.UniV2;
}

/** A 20-byte EVM address, as an ordinary `0x`-prefixed hex string. */
export type Address = `0x${string}`;

/** A `0x`-prefixed hex byte string (used for `SwapParams.callback`). */
export type Hex = `0x${string}`;

/** Anything {@link toSwapParams} accepts for an address-shaped field. */
export type AddressInput = Address | bigint;

/** Anything {@link toSwapParams} accepts for a numeric-shaped field. */
export type AmountInput = bigint | number | string;

/**
 * `SwapParams.poolKey` as the caller may supply it — every field optional; unset fields default to
 * `0n` (see `toSwapParams`'s per-pool-type rules for which defaults are actually meaningful).
 */
export interface PoolKeyInput {
  currency0?: AddressInput;
  currency1?: AddressInput;
  fee?: AmountInput;
  tickSpacing?: AmountInput;
  hooks?: AddressInput;
}

/** `SwapParams.poolKey`, fully normalized — 5 bigint fields, in ABI-declaration order. */
export interface PoolKey {
  currency0: bigint;
  currency1: bigint;
  fee: bigint;
  tickSpacing: bigint;
  hooks: bigint;
}

/** All-zero `poolKey`, used for any pool type that doesn't consult it (see {@link usesPoolKey}). */
export const ZERO_POOL_KEY: PoolKey = {
  currency0: 0n,
  currency1: 0n,
  fee: 0n,
  tickSpacing: 0n,
  hooks: 0n,
};

/**
 * The chain-agnostic swap SPEC a caller builds — the input to {@link toSwapParams} /
 * `swapCallStatement` / `swapSource`. `amountIn` is always a single, unambiguous POSITIVE
 * exact-input amount; {@link amountSpecifiedFor} does the per-path sign normalization.
 *
 * `payer`/`recipient` default to the SauceScript call `ctx.self()` (Router swap entries are
 * `onlySelf`) — leave them unset unless you specifically need a different payer/recipient (which
 * then disqualifies a non-empty `callback`, see `toSwapParams`'s guard).
 */
export interface SwapSpec {
  poolType: SwapPoolType;
  pool: AddressInput;
  /** Required (all 5 fields) for UniV4; `fee` alone is meaningful for UniV2 (LP fee in ppm, `0` →
   *  engine default 3000). Ignored for every other pool type. See {@link usesPoolKey}. */
  poolKey?: PoolKeyInput;
  tokenIn: AddressInput;
  tokenOut: AddressInput;
  /** A positive exact-input amount. See `amountSpecifiedFor` for the per-path sign this becomes. */
  amountIn: AmountInput;
  sqrtPriceLimitX96?: AmountInput;
  /** Defaults to `ctx.self()`. Overriding this while also passing a non-empty `callback` is
   *  rejected — see `toSwapParams`'s guard mirroring `Router.sol`'s own `payer == recipient ==
   *  address(this)` check for a callback-driven swap. */
  payer?: AddressInput;
  /** Defaults to `ctx.self()`. See `payer`'s note. */
  recipient?: AddressInput;
  /** Opaque, already-compiled callback bytes for a Tier-1 flash fragment. Only valid for
   *  {@link isCallbackVenue} pool types; building one is out of scope here — see
   *  `sdk/src/swap/index.ts`'s scope notes. Defaults to empty (`"0x"`). */
  callback?: Hex;
}

/**
 * The one extra shape `swapCallStatement`/`swapSource` accept beyond {@link SwapSpec}:
 * `amountIn: "balance"` emits a RUNTIME `IERC20.at(tokenIn).balanceOf(ctx.self())` read instead
 * of a baked-in literal — the shape a multi-leg program needs when a later leg's input is an
 * earlier leg's (unknown at compile time) output. `toSwapParams` does NOT accept this shape: it
 * produces a concrete `SwapParams` object, which a runtime-derived amount cannot be.
 */
export type SwapSourceSpec = SwapSpec | (Omit<SwapSpec, "amountIn"> & { amountIn: "balance" });

/**
 * `ISauceRouter.swap`'s `SwapParams`, fully normalized — every scalar a `bigint` (SauceScript- and
 * viem-native), in exact ABI-declaration order (see `SWAP_PARAMS_FIELDS`, pinned against the
 * vendored artifact in `sdk/test/swap.test.ts`). `payer`/`recipient` are `bigint | "self"`: `"self"`
 * is the unresolved `ctx.self()` sentinel (this contract's own address, not knowable off-chain
 * without the Pot address), preserved rather than eagerly resolved so a caller can tell the two
 * cases apart.
 *
 * **Sign note (load-bearing, do not "fix" from the struct doc comment):** `IRouter.sol`'s own
 * `SwapParams.amountSpecified` comment claims "Negative = exact input, Positive = exact output"
 * universally. That is wrong for UniV3 — `Router.sol:431` passes it straight into Uniswap V3's
 * pool, whose OWN convention is positive = exact input (fork-verified; see this repo's CLAUDE.md).
 * `amountSpecifiedFor` follows the CODE, not the comment.
 */
export interface SwapParams {
  poolType: SwapPoolType;
  pool: bigint;
  poolKey: PoolKey;
  tokenIn: bigint;
  tokenOut: bigint;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
  payer: bigint | "self";
  recipient: bigint | "self";
  callback: Hex;
}

/** `SwapParams`'s top-level field names, in exact ABI-declaration order (pinned against the
 *  vendored `ISauceRouter.json` artifact in `sdk/test/swap.test.ts`). */
export const SWAP_PARAMS_FIELDS: readonly (keyof SwapParams)[] = [
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
export const POOL_KEY_FIELDS: readonly (keyof PoolKey)[] = [
  "currency0",
  "currency1",
  "fee",
  "tickSpacing",
  "hooks",
];
