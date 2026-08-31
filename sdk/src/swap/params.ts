/**
 * Normalization core for E4.1's universal swap adapter — `toSwapParams` + `amountSpecifiedFor`.
 * See `sdk/src/swap/index.ts` for the module overview.
 */
import {
  isCallbackVenue,
  SwapPoolType,
  UndispatchablePoolType,
  usesPoolKey,
  ZERO_POOL_KEY,
  type AddressInput,
  type AmountInput,
  type Hex,
  type PoolKey,
  type PoolKeyInput,
  type SwapParams,
  type SwapSpec,
} from "./types.js";

const DISPATCHABLE_POOL_TYPES: ReadonlySet<number> = new Set(Object.values(SwapPoolType));
const UNDISPATCHABLE_POOL_TYPES: ReadonlySet<number> = new Set(Object.values(UndispatchablePoolType));

/** UniV2's pair-fee ceiling — `Router.sol#_swapV2` reverts at/above this (ppm; 1_000_000 = 100%). */
const MAX_UNIV2_FEE_PPM = 1_000_000n;

function toBigIntStrict(value: AmountInput, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`${label}: expected an integer, got ${value}`);
    return BigInt(value);
  }
  // string: decimal or 0x-hex, either accepted by BigInt() directly.
  return BigInt(value);
}

function toAddressBigint(value: AddressInput, label: string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

function normalizePoolKey(poolType: SwapPoolType, input: PoolKeyInput | undefined): PoolKey {
  if (poolType === SwapPoolType.UniV4) {
    if (input === undefined) {
      throw new Error(
        "toSwapParams: poolKey is required for UniV4 (currency0, currency1, fee, tickSpacing, hooks)",
      );
    }
    return {
      currency0: input.currency0 !== undefined ? toAddressBigint(input.currency0, "poolKey.currency0") : 0n,
      currency1: input.currency1 !== undefined ? toAddressBigint(input.currency1, "poolKey.currency1") : 0n,
      fee: input.fee !== undefined ? toBigIntStrict(input.fee, "poolKey.fee") : 0n,
      tickSpacing:
        input.tickSpacing !== undefined ? toBigIntStrict(input.tickSpacing, "poolKey.tickSpacing") : 0n,
      hooks: input.hooks !== undefined ? toAddressBigint(input.hooks, "poolKey.hooks") : 0n,
    };
  }

  if (poolType === SwapPoolType.UniV2) {
    const fee = input?.fee !== undefined ? toBigIntStrict(input.fee, "poolKey.fee") : 0n;
    if (fee >= MAX_UNIV2_FEE_PPM) {
      throw new Error(
        `toSwapParams: poolKey.fee (${fee}) must be < ${MAX_UNIV2_FEE_PPM} ppm for UniV2 (Router.sol reverts at/above it); 0 means the engine's default 3000 (0.30%)`,
      );
    }
    return { ...ZERO_POOL_KEY, fee };
  }

  // Every other pool type ignores poolKey entirely — see usesPoolKey.
  return ZERO_POOL_KEY;
}

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
export function amountSpecifiedFor(poolType: SwapPoolType, amountIn: bigint): bigint {
  if (amountIn < 0n) {
    throw new Error(`amountSpecifiedFor: amountIn must be a positive exact-input amount, got ${amountIn}`);
  }
  if (poolType === SwapPoolType.UniV4) {
    return amountIn === 0n ? 0n : 2n ** 256n - amountIn;
  }
  return amountIn;
}

function normalizeCallback(
  poolType: SwapPoolType,
  callback: Hex | undefined,
  payerOverridden: boolean,
  recipientOverridden: boolean,
): Hex {
  const value = callback ?? "0x";
  if (value === "0x") return value;

  if (!isCallbackVenue(poolType)) {
    throw new Error(
      `toSwapParams: a non-empty callback is only valid for a callback-driven pool type (UniV3, UniV4, MaverickV2) — Router.sol's swap() rejects it for poolType ${poolType}`,
    );
  }
  if (payerOverridden || recipientOverridden) {
    throw new Error(
      "toSwapParams: a non-empty callback requires payer and recipient to both stay ctx.self() — Router.sol's callback-driven handlers require payer == recipient == address(this)",
    );
  }
  return value;
}

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
export function toSwapParams(spec: SwapSpec): SwapParams {
  const { poolType } = spec;

  if (UNDISPATCHABLE_POOL_TYPES.has(poolType)) {
    throw new Error(
      `toSwapParams: poolType ${poolType} (PancakeInfinity CL/Bin) is not dispatchable through the unified swap() — Router.sol falls through to revert SwapFailed(). Use the dedicated swapInfinityCL/swapInfinityBin entry points instead (a follow-up, not built by this module).`,
    );
  }
  if (!DISPATCHABLE_POOL_TYPES.has(poolType)) {
    throw new Error(`toSwapParams: unknown poolType ${poolType} (expected one of SwapPoolType's 0..8)`);
  }

  const payerOverridden = spec.payer !== undefined;
  const recipientOverridden = spec.recipient !== undefined;

  const params: SwapParams = {
    poolType,
    pool: toAddressBigint(spec.pool, "pool"),
    poolKey: usesPoolKey(poolType) ? normalizePoolKey(poolType, spec.poolKey) : ZERO_POOL_KEY,
    tokenIn: toAddressBigint(spec.tokenIn, "tokenIn"),
    tokenOut: toAddressBigint(spec.tokenOut, "tokenOut"),
    amountSpecified: amountSpecifiedFor(poolType, toBigIntStrict(spec.amountIn, "amountIn")),
    sqrtPriceLimitX96:
      spec.sqrtPriceLimitX96 !== undefined
        ? toBigIntStrict(spec.sqrtPriceLimitX96, "sqrtPriceLimitX96")
        : 0n,
    payer: payerOverridden ? toAddressBigint(spec.payer as AddressInput, "payer") : "self",
    recipient: recipientOverridden ? toAddressBigint(spec.recipient as AddressInput, "recipient") : "self",
    callback: normalizeCallback(poolType, spec.callback, payerOverridden, recipientOverridden),
  };

  return params;
}
