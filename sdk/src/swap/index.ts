/**
 * EVM swap program builders for `@eco-incorp/sauce`.
 *
 * `toSwapParams` normalizes a swap specification into the Sauce Router's `SwapParams` shape.
 * `swapSource` emits a complete program; `swapCallStatement` emits a statement for composition.
 * These helpers construct source synchronously and do not compile or send transactions.
 *
 * Compile the generated source with `routes.compileSauceRoute`, supplying both `pot` and `engine`.
 * The route compiler serves the `ISauceRouter`/`IERC20` ABIs the program imports, and annotates a
 * falling-through `main` as `void` before passing it to the compiler dependency.
 *
 * A program calls the Router through `ctx.self()`, using the Pot's Router dispatch. Multiple
 * specifications passed to `swapSource` become sequential swaps in one program and one cook.
 * Separate compiled programs can be composed with
 * `routes.buildSauceEvmCalls({ pot, engine, cooks: [swapHex, settleHex] })`.
 *
 * The unified `swap()` path supports pool types 0..8. Pancake Infinity CL/Bin require different
 * Router entry points and are rejected here. Callback data, when supported by the pool type,
 * must be supplied as an already compiled program. This builder discards the swap's return
 * values; enforce an output requirement with an explicit balance/delta check or settlement.
 *
 * See `docs/guides/builders-and-actions.md` for public usage and composition examples.
 */
export {
  SwapPoolType,
  UndispatchablePoolType,
  ZERO_POOL_KEY,
  SWAP_PARAMS_FIELDS,
  POOL_KEY_FIELDS,
  isCallbackVenue,
  isCallbackFree,
  usesPoolKey,
} from "./types.js";
export type {
  Address,
  Hex,
  AddressInput,
  AmountInput,
  PoolKey,
  PoolKeyInput,
  SwapSpec,
  SwapSourceSpec,
  SwapParams,
} from "./types.js";

export { toSwapParams, amountSpecifiedFor } from "./params.js";

export { swapCallStatement, swapSource, swapImportLines } from "./source.js";
export type { SwapSourceOptions } from "./source.js";
