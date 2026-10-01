/**
 * Swap actions -> quote calls: an `eth_call` a client sends to price a swap (`quoteAction`), and
 * the same call emitted as SauceScript, which the split swap runs on-chain (`quoteCall`).
 *
 * The on-chain form is statements plus the `uint256` expression they leave available (a
 * [`Fragment`]); a quote's return shape maps onto an `abi.decode` shape string — see [`Shape`].
 *
 * Where the SDK's protocol registry declares the quote function exactly — the same selector,
 * input types and outputs — its calldata and decoding come from that registry fragment
 * (`registryFunction`, checked the way `abis.ts` checks a binding). The rest of the quoters are
 * not in the registry, and their signatures are written here.
 */
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  encodeFunctionData,
  decodeAbiParameters,
  getAddress,
  parseAbiItem,
  type AbiFunction,
} from "viem";

import { registryFunction } from "./abis.js";
import { CurveRouterNGABI, CurveThreePoolABI } from "./registry.js";
import {
  bindBytes,
  bindConst,
  encodeArgs,
  formatBigint,
  hexToBytes,
  type Emitter,
  type Expr,
  type Fragment,
  type Stmt,
} from "./emit.js";

import { resolveChain, type ChainRef } from "../../sdk/dist/chains/canonical.js";
import { resolveNames, usesNames } from "./names.js";
import { parseActions } from "./program.js";
import { ProgramError } from "./semantics.js";
import type {
  SwapAction,
  UniswapV2SwapAction,
  UniswapV3SwapAction,
  UniswapV4SwapAction,
  CurveSwapAction,
  BalancerV2SwapAction,
  DodoV2SwapAction,
  TraderJoeLBSwapAction,
  WoofiSwapAction,
  MaverickV2SwapAction,
  CurveRouterNGSwapAction,
  BalancerV2BatchSwapAction,
  BalancerV3SwapAction,
  AmbientSwapAction,
  DodoV1SwapAction,
  CarbonSwapAction,
  FluidDexT1SwapAction,
} from "./types.js";

type Address = `0x${string}`;
type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A quote as an `eth_call`: send `data` to `to`, and `decode` the result into the output amount. */
export interface Quote {
  readonly to: Address;
  readonly data: Hex;
  decode(result: Hex): bigint;
}

/** A quote, plus its on-chain forms where the protocol's quoter can run inside a transaction. */
export interface QuoteCall extends Quote {
  /** The quote as SauceScript statements, leaving the output amount as their expression. */
  readonly toSauce?: (emit: Emitter) => Fragment;
  /**
   * The same, with the input amount a runtime expression spliced in at the quote's fixed amount
   * offset — what the split swap needs. Absent where the amount has no fixed offset.
   */
  readonly toSauceDynamic?: (emit: Emitter, amountExpr: Expr) => Fragment;
}

/**
 * The quoter contracts for venues that price through one rather than through the pool or router
 * the action names.
 */
export interface QuoteOptions {
  /**
   * The chain the swap is on: needed when the action names a token or a contract, which resolve
   * there to the addresses the quote calls.
   */
  readonly chain?: ChainRef;
  /**
   * The Sauce Router, for `uniswapV3Swap` and `uniswapV4Swap`: the contract that swaps them prices
   * them, with its own `quote`, which needs no tokens. A Pot's Router is the Kitchen's Router until
   * the Pot's owner moves it; `v12RouterAddress()` from `@eco-incorp/sauce/deployments` is the
   * release's.
   */
  readonly router?: Address;
  /** The MaverickV2Quoter, for `maverickV2Swap`. */
  readonly maverickQuoter?: Address;
  /** Ambient's CrocImpact, for `ambientSwap`. */
  readonly ambientImpact?: Address;
  /** Fluid's DexReservesResolver, for `fluidDexT1Swap`. */
  readonly fluidDexResolver?: Address;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sel(sig: string): Hex {
  return keccak256(toBytes(sig)).slice(0, 10) as Hex;
}

/** A registry function's calldata: its selector, then `args` encoded by its own input types. */
function callData(fn: AbiFunction, args: readonly unknown[]): Hex {
  return encodeFunctionData({ abi: [fn], functionName: fn.name, args });
}

/** `result` decoded by a registry function's own output types. */
function returned(fn: AbiFunction, result: Hex): readonly unknown[] {
  return decodeAbiParameters(fn.outputs, result);
}

function concatHex(a: Hex, b: Hex): Hex {
  return (a + b.slice(2)) as Hex;
}

const decodeUint256 = (data: Hex): bigint => decodeAbiParameters([{ type: "uint256" }], data)[0];

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;

/**
 * A token or contract field of an action `quoteCall` was given: an address, because `quoteAction`
 * and the split swap resolve every name on their chain first, and a quote is calldata built here.
 */
const at = (value: string | undefined): Address => value as Address;

// ---------------------------------------------------------------------------
// On-chain extraction — every helper yields a Fragment whose expr is a uint256
// ---------------------------------------------------------------------------

/**
 * An `abi.decode` shape: one shape string per decoded field, parsed at compile time. This is what
 * the retired compiler's `OutputSpec` (`{count, typeSpecs}`) becomes — `[OPS.BYTE_32]` is
 * `["Uint256"]`, `[OPS.ARRAY, OPS.BYTE_32]` is `["Uint256[]"]`.
 */
type Shape = readonly string[];

/** Return data is a single uint256. */
const OUT_UINT256: Shape = ["Uint256"];
/** Return data is a single dynamic uint256[] (or int256[] read as its two's-complement words). */
const OUT_UINT256_ARRAY: Shape = ["Uint256[]"];
/** Ambient's `(int128 baseFlow, int128 quoteFlow, uint128 finalPrice)` — three static words. */
const AMBIENT_OUTPUT: Shape = ["Uint256", "Uint256", "Uint256"];

/** `count` static 32-byte fields. */
function words(count: number): Shape {
  return Array<string>(count).fill("Uint256");
}

function shapeLiteral(shape: Shape): string {
  return `[${shape.map((s) => `"${s}"`).join(", ")}]`;
}

/**
 * Two ways to invoke a quoter on-chain:
 *
 * - `'static'` — STATICCALL (`evm.static`). Use for pure-view quoters that make no state
 *   changes (Curve `get_dy`, Carbon, DODO, a V2 pair's `getReserves`, LB `getSwapOut`, WooPPV2
 *   `query`, Ambient `calcImpact`). Blocking state writes is exactly the safety property we want —
 *   the quoter target may be caller-supplied (the action's own `pool`/`controller`/`router`
 *   field), so STATICCALL keeps a malicious or buggy target from re-entering or mutating state.
 *
 * - `'call'` — regular CALL with `value=0` (`evm.call`). Use for revert-simulation
 *   quoters (the Sauce Router's `quote` for UniV3/UniV4, MaverickV2Quoter, Fluid
 *   resolvers). They trigger `pool.swap(...)` internally — a state-writing
 *   function that reverts after the callback. STATICCALL would block those
 *   writes and produce an unparseable revert; the pool's own revert at the
 *   end of the simulation rolls back all writes, so CALL is safe here.
 */
type QuoterMode = "static" | "call";

function invoke(mode: QuoterMode, to: Address, cd: Expr): Expr {
  const target = formatBigint(BigInt(to));

  return mode === "static" ? `evm.static(${target}, ${cd})` : `evm.call(${target}, 0n, ${cd})`;
}

/**
 * Call the quoter and bind the decoded tuple.
 *
 * Both the return data and the decoded tuple are bound. That is not tidiness: a projection
 * re-evaluates the object it embeds, so an extractor reading two fields off an unbound
 * `abi.decode(evm.call(…), …)` would issue the quoter call twice.
 */
function decodeCall(
  emit: Emitter,
  mode: QuoterMode,
  to: Address,
  cd: Fragment,
  shape: Shape,
): Fragment {
  const ret = bindConst(emit, "qret", invoke(mode, to, cd.expr));
  const dec = bindConst(emit, "qdec", `abi.decode(${ret.expr}, ${shapeLiteral(shape)})`);

  return { stmts: [...cd.stmts, ...ret.stmts, ...dec.stmts], expr: dec.expr };
}

/** Pulls the output amount out of a bound decoded tuple. */
type Extract = (emit: Emitter, decoded: Fragment) => Fragment;

/** Most quotes: the first field is the uint256 amount. */
const firstWord: Extract = (_emit, decoded) => ({
  stmts: decoded.stmts,
  expr: `${decoded.expr}[0]`,
});

/** Field `index` of a tuple of static words. */
function nthWord(index: number): Extract {
  return (_emit, decoded) => ({ stmts: decoded.stmts, expr: `${decoded.expr}[${index}]` });
}

/** Return is uint256[] (e.g. V2 getAmountsOut) — take the last element. */
const arrayLast: Extract = (emit, decoded) => {
  const arr = bindConst(emit, "qarr", `${decoded.expr}[0]`);

  return { stmts: [...decoded.stmts, ...arr.stmts], expr: `${arr.expr}[${arr.expr}.length - 1n]` };
};

/**
 * Return is int256[] (e.g. BalancerV2 queryBatchSwap deltas). The entry at
 * `index` is known to be negative (tokens owed to the caller) — negate it to
 * recover the magnitude. Unary `-` is two's-complement negation, so it wraps
 * rather than tripping an overflow check the way a checked `0 - x` would.
 */

/**
 * Pick the negative flow from Ambient's `(int128 baseFlow, int128 quoteFlow,
 * uint128 finalPrice)` return tuple and negate it. Branchless:
 *   sign(x) = x >> 255  (0 for non-negative, 1 for negative after sign-ext)
 *   result  = -(sign(base)*base + sign(quote)*quote)
 */
const ambientFlow: Extract = (emit, decoded) => {
  const base = bindConst(emit, "qbase", `${decoded.expr}[0]`);
  const quote = bindConst(emit, "qquote", `${decoded.expr}[1]`);
  const sum = bindConst(
    emit,
    "qsum",
    `(${base.expr} >> 255n) * ${base.expr} + (${quote.expr} >> 255n) * ${quote.expr}`,
  );

  return {
    stmts: [...decoded.stmts, ...base.stmts, ...quote.stmts, ...sum.stmts],
    expr: `-${sum.expr}`,
  };
};

/** A whole pre-computed quote call, as an on-chain fragment. */
function staticQuote(
  mode: QuoterMode,
  to: Address,
  data: Hex,
  shape: Shape,
  extract: Extract,
): (emit: Emitter) => Fragment {
  return (emit) => {
    const cd = bindBytes(emit, "qcd", hexToBytes(data));

    return extract(emit, decodeCall(emit, mode, to, cd, shape));
  };
}

/** Most quotes: first 32-byte word of return is the uint256 amount. */
function asUint256(mode: QuoterMode, to: Address, data: Hex): (emit: Emitter) => Fragment {
  return staticQuote(mode, to, data, OUT_UINT256, firstWord);
}

/** Return is uint256[] (e.g. V2 getAmountsOut) — take the last element. */
function asUint256ArrayLast(mode: QuoterMode, to: Address, data: Hex): (emit: Emitter) => Fragment {
  return staticQuote(mode, to, data, OUT_UINT256_ARRAY, arrayLast);
}

/**
 * Return is a tuple of `count` static 32-byte fields (all uint256 or sign-
 * extended int/uint with width ≤ 256). Pick the field at `index`.
 */
function asTupleFieldUint256(
  mode: QuoterMode,
  to: Address,
  data: Hex,
  count: number,
  index: number,
): (emit: Emitter) => Fragment {
  if (index === 0) return asUint256(mode, to, data);

  return staticQuote(mode, to, data, words(count), nthWord(index));
}

function asAmbientFlow(mode: QuoterMode, to: Address, data: Hex): (emit: Emitter) => Fragment {
  return staticQuote(mode, to, data, AMBIENT_OUTPUT, ambientFlow);
}

/**
 * Build a runtime-amount variant of a fixed-offset quote.
 *
 * `amountOffset` is the byte offset where the 32-byte uint256 amount word
 * lives in the pre-computed calldata. At runtime the program concats
 *   prefix = data[0:amountOffset]   (selector + preceding ABI head slots)
 *   amount = abi.encode({amountExpr})       (32 bytes)
 *   suffix = data[amountOffset+32:] (trailing head slots + dynamic tail)
 * and invokes the quoter. Each pre-encoded run is a bound `hex` const, because a method call's
 * receiver has to be an identifier.
 */
function makeDynamic(
  mode: QuoterMode,
  to: Address,
  data: Hex,
  amountOffset: number,
  shape: Shape,
  extract: Extract,
): (emit: Emitter, amountExpr: Expr) => Fragment {
  const bytes = hexToBytes(data);
  const prefixBytes = bytes.slice(0, amountOffset);
  const suffixBytes = bytes.slice(amountOffset + 32);

  return (emit, amountExpr) => {
    const prefix = bindBytes(emit, "qpre", prefixBytes);
    const stmts: Stmt[] = [...prefix.stmts];
    const parts: Expr[] = [encodeArgs([amountExpr])];
    if (suffixBytes.length > 0) {
      const suffix = bindBytes(emit, "qsuf", suffixBytes);
      stmts.push(...suffix.stmts);
      parts.push(suffix.expr);
    }
    const cd: Fragment = { stmts, expr: `${prefix.expr}.concat(${parts.join(", ")})` };

    return extract(emit, decodeCall(emit, mode, to, cd, shape));
  };
}

function required(options: QuoteOptions, name: Exclude<keyof QuoteOptions, "chain">): Address {
  const value = options[name];
  if (!value) throw new Error(`quoting this action needs \`${name}\` in the quote options`);
  return value;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * The `eth_call` that prices `action` at its own `amount` (a Carbon trade or a Balancer batch at
 * the amounts it carries). None needs a balance or an allowance. Venues that price through a
 * separate quoter take its address from `options`.
 */
export function quoteAction(action: SwapAction, options: QuoteOptions = {}): Quote {
  let [checked] = parseActions([action], "action") as [SwapAction];
  if ((checked as { factory?: string }).factory !== undefined) {
    throw new Error(
      "quoteAction prices a pool at its address, and a pool named by its key (`factory`) is found " +
        "only on chain: read it there first (the factory's getPool/getPair), then give `pool`",
    );
  }
  if (usesNames([checked])) {
    const chain = options.chain === undefined ? undefined : resolveChain(options.chain);
    if (chain === undefined) {
      throw new Error(
        "quoteAction: the action names a token or a contract — pass `chain` to resolve it on",
      );
    }
    const { resolved, issues } = resolveNames([checked], chain, "action");
    if (issues.length > 0) throw new ProgramError(issues, chain);
    checked = resolved[0] as SwapAction;
  }
  const amount = (checked as { amount?: string }).amount;
  const explicit = checked.type === "carbonSwap" || checked.type === "balancerV2BatchSwap";
  if (amount === undefined && !explicit) {
    throw new Error(`quoteAction: set the ${checked.type}'s \`amount\` to quote it`);
  }
  const { to, data, decode } = quoteCall(checked, BigInt(amount ?? 0), options);

  return { to, data, decode };
}

/** The quote for `action` at `amountIn`, with its on-chain forms where there are any. */
export function quoteCall(
  action: SwapAction,
  amountIn: bigint,
  opts: QuoteOptions = {},
): QuoteCall {
  switch (action.type) {
    // --- On the same contract as the action ---
    case "uniswapV2Swap":
      return quoteUniswapV2(action, amountIn);
    case "curveSwap":
      return quoteCurve(action, amountIn);
    case "balancerV2Swap":
      return quoteBalV2Single(action, amountIn);
    case "dodoV2Swap":
      return quoteDodoV2(action, amountIn);
    case "traderJoeLBSwap":
      return quoteTraderJoeLB(action, amountIn);
    case "woofiSwap":
      return quoteWoofi(action, amountIn);
    case "curveRouterNGSwap":
      return quoteCurveRouterNG(action, amountIn);
    case "fraxswapSwap":
      return quoteFraxswap(at(action.router), action.path.map(at), amountIn);
    case "balancerV2BatchSwap":
      return quoteBalV2Batch(action);
    case "balancerV3Swap":
      return quoteBalV3(action, amountIn);
    case "carbonSwap":
      return quoteCarbon(action);
    case "dodoV1Swap":
      return quoteDodoV1(action, amountIn);

    // --- The Sauce Router, which swaps them ---
    case "uniswapV3Swap":
      return quoteThroughRouter(action, amountIn, required(opts, "router"));
    case "uniswapV4Swap":
      return quoteThroughRouter(action, amountIn, required(opts, "router"));

    // --- Separate quoter / resolver contract ---
    case "maverickV2Swap":
      return quoteMaverickV2(action, amountIn, required(opts, "maverickQuoter"));
    case "ambientSwap":
      return quoteAmbient(action, amountIn, required(opts, "ambientImpact"));
    case "fluidDexT1Swap":
      return quoteFluidT1(action, amountIn, required(opts, "fluidDexResolver"));

    default: {
      const _: never = action;
      throw new Error(`Unknown action type: ${(_ as { type: string }).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// View functions — on the same contract referenced by the action
// ---------------------------------------------------------------------------

/**
 * Curve pool — `get_dy(i, j, dx)` in the pool's own index type: `int128` from the registry's 3pool
 * ABI for a StableSwap or NG pool, `uint256` for a CryptoSwap pool (its selector differs, and the
 * registry has no CryptoSwap ABI). Either way the arguments are three words.
 */
function quoteCurve(action: CurveSwapAction, amountIn: bigint): QuoteCall {
  const fn =
    action.indexType === "uint256"
      ? (parseAbiItem(
          "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
        ) as AbiFunction)
      : registryFunction(
          "curve",
          "CurveThreePoolABI",
          CurveThreePoolABI,
          "get_dy(int128,int128,uint256)",
        );
  const to = at(action.pool);
  const data = callData(fn, [BigInt(action.i), BigInt(action.j), amountIn]);
  return {
    to,
    data,
    decode: (result: Hex) => returned(fn, result)[0] as bigint,
    toSauce: asUint256("static", to, data),
    // selector(4) + i(32) + j(32) = 68
    toSauceDynamic: makeDynamic("static", to, data, 68, OUT_UINT256, firstWord),
  };
}

/** Curve Router NG — `get_dy(address[11],uint256[5][5],uint256,address[5])`. */
function quoteCurveRouterNG(action: CurveRouterNGSwapAction, amountIn: bigint): QuoteCall {
  const route = [...action.route] as Address[];
  while (route.length < 11) route.push(ZERO_ADDR);
  const swapParams = [...action.swapParams] as [number, number, number, number, number][];
  while (swapParams.length < 5) swapParams.push([0, 0, 0, 0, 0]);
  const pools = [...action.pools] as Address[];
  while (pools.length < 5) pools.push(ZERO_ADDR);

  const fn = registryFunction(
    "curve",
    "CurveRouterNGABI",
    CurveRouterNGABI,
    "get_dy(address[11],uint256[5][5],uint256,address[5])",
  );
  const to = at(action.router);
  const data = callData(fn, [
    route,
    swapParams.map((r) => r.map((v) => BigInt(v))),
    amountIn,
    pools,
  ]);
  return {
    to,
    data,
    decode: (result: Hex) => returned(fn, result)[0] as bigint,
    toSauce: asUint256("static", to, data),
    // selector(4) + address[11] (11*32) + uint256[5][5] (25*32) = 1156
    toSauceDynamic: makeDynamic("static", to, data, 1156, OUT_UINT256, firstWord),
  };
}

/**
 * Uniswap V2 pair — `getReserves()` (view), priced exactly as `@sauce/router`'s `uniswapV2` prices
 * it: the Router's constant-product math, the fee in ppm (absent or 0 is 3000), the direction from
 * the sort order. The amount is not in the calldata, so the on-chain form applies it after the read.
 */
function quoteUniswapV2(action: UniswapV2SwapAction, amountIn: bigint): QuoteCall {
  const fee = BigInt(action.feePpm === undefined || action.feePpm === 0 ? 3000 : action.feePpm);
  const zeroForOne = BigInt(action.tokenIn) < BigInt(action.tokenOut);
  const [inIndex, outIndex] = zeroForOne ? [0, 1] : [1, 0];
  const to = at(action.pool);
  const data = sel("getReserves()");
  const price = (reserveIn: bigint, reserveOut: bigint): bigint => {
    const inWithFee = amountIn * (1_000_000n - fee);
    return (inWithFee * reserveOut) / (reserveIn * 1_000_000n + inWithFee);
  };
  const onChain = (emit: Emitter, amountExpr: Expr): Fragment => {
    const cd = bindBytes(emit, "qcd", hexToBytes(data));
    const decoded = decodeCall(emit, "static", to, cd, words(3));
    const inWithFee = bindConst(emit, "qw", `${amountExpr} * ${formatBigint(1_000_000n - fee)}`);
    return {
      stmts: [...decoded.stmts, ...inWithFee.stmts],
      expr:
        `Math.mulDiv(${inWithFee.expr}, ${decoded.expr}[${outIndex}], ` +
        `${decoded.expr}[${inIndex}] * 1000000n + ${inWithFee.expr})`,
    };
  };

  return {
    to,
    data,
    decode: (result: Hex) => {
      const reserves = decodeAbiParameters(
        [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
        result,
      );
      return price(reserves[inIndex] as bigint, reserves[outIndex] as bigint);
    },
    toSauce: (emit) => onChain(emit, formatBigint(amountIn)),
    toSauceDynamic: onChain,
  };
}

/**
 * Fraxswap — router `getAmountsOutWithTwamm` (state-changing, so CALL). The view `getAmountsOut`
 * reverts with "twamm out of date" whenever a pair's TWAMM has pending virtual orders; this variant
 * executes them first, which is what the router's own swap does.
 */
function quoteFraxswap(router: Address, path: Address[], amountIn: bigint): QuoteCall {
  const to = router;
  const data = concatHex(
    sel("getAmountsOutWithTwamm(uint256,address[])"),
    encodeAbiParameters([{ type: "uint256" }, { type: "address[]" }], [amountIn, path]),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      const [amounts] = decodeAbiParameters([{ type: "uint256[]" }], result);
      return amounts[amounts.length - 1];
    },
    toSauce: asUint256ArrayLast("call", to, data),
    toSauceDynamic: makeDynamic("call", to, data, 4, OUT_UINT256_ARRAY, arrayLast),
  };
}

// --- BalancerV2 via queryBatchSwap ---

const BATCH_SWAP_STEP_ABI = {
  type: "tuple[]" as const,
  components: [
    { type: "bytes32" as const, name: "poolId" },
    { type: "uint256" as const, name: "assetInIndex" },
    { type: "uint256" as const, name: "assetOutIndex" },
    { type: "uint256" as const, name: "amount" },
    { type: "bytes" as const, name: "userData" },
  ],
};

const FUND_MGMT_ABI = {
  type: "tuple" as const,
  components: [
    { type: "address" as const, name: "sender" },
    { type: "bool" as const, name: "fromInternalBalance" },
    { type: "address" as const, name: "recipient" },
    { type: "bool" as const, name: "toInternalBalance" },
  ],
};

const QUERY_BATCH_SWAP_SEL = sel(
  "queryBatchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool))",
);

function buildQueryBatchSwap(
  vault: Address,
  steps: Array<{ poolId: Hex; assetInIndex: bigint; assetOutIndex: bigint; amount: bigint }>,
  assets: Address[],
  outAssetIndex: number,
): QuoteCall {
  const data = concatHex(
    QUERY_BATCH_SWAP_SEL,
    encodeAbiParameters(
      [{ type: "uint8" }, BATCH_SWAP_STEP_ABI, { type: "address[]" }, FUND_MGMT_ABI],
      [
        0, // GIVEN_IN
        steps.map((s) => ({
          poolId: s.poolId,
          assetInIndex: s.assetInIndex,
          assetOutIndex: s.assetOutIndex,
          amount: s.amount,
          userData: "0x" as Hex,
        })),
        assets,
        {
          sender: ZERO_ADDR,
          fromInternalBalance: false,
          recipient: ZERO_ADDR,
          toInternalBalance: false,
        },
      ],
    ),
  );

  return {
    to: vault,
    data,
    decode: (result: Hex) => {
      const [deltas] = decodeAbiParameters([{ type: "int256[]" }], result);
      const out = deltas[outAssetIndex];
      return out < 0n ? -out : out;
    },
  };
}

/** BalancerV2 single swap — converted to `queryBatchSwap`. */
function quoteBalV2Single(action: BalancerV2SwapAction, amountIn: bigint): QuoteCall {
  const base = buildQueryBatchSwap(
    at(action.vault),
    [{ poolId: action.poolId, assetInIndex: 0n, assetOutIndex: 1n, amount: amountIn }],
    [at(action.tokenIn), at(action.tokenOut)],
    1,
  );
  // Neither `toSauce` nor `toSauceDynamic`, here or on the batch variant: the Vault implements
  // `queryBatchSwap` by performing the swap and reverting with the encoded deltas, so it mutates
  // state and cannot run inside the STATICCALL an on-chain quote issues. Any emitted form of it is
  // a program that reverts. It is an `eth_call`-only quote, reachable through `decode` and nothing
  // else.
  return base;
}

/** BalancerV2 batch swap — `queryBatchSwap`. */
function quoteBalV2Batch(action: BalancerV2BatchSwapAction): QuoteCall {
  const lastStep = action.steps[action.steps.length - 1];
  return buildQueryBatchSwap(
    at(action.vault),
    action.steps.map((s) => ({
      poolId: s.poolId,
      assetInIndex: BigInt(s.assetInIndex),
      assetOutIndex: BigInt(s.assetOutIndex),
      amount: BigInt(s.amount),
    })),
    action.assets.map(at),
    lastStep.assetOutIndex,
  );
}

/**
 * BalancerV3 — `querySwapSingleTokenExactIn`. The Vault answers a query only outside a
 * transaction (`tx.origin` zero, as in an `eth_call` from the zero address), so this quote has no
 * on-chain form.
 */
function quoteBalV3(action: BalancerV3SwapAction, amountIn: bigint): QuoteCall {
  const to = at(action.router);
  const data = concatHex(
    sel("querySwapSingleTokenExactIn(address,address,address,uint256,address,bytes)"),
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes" },
      ],
      [at(action.pool), at(action.tokenIn), at(action.tokenOut), amountIn, ZERO_ADDR, "0x"],
    ),
  );
  return { to, data, decode: decodeUint256 };
}

/**
 * Carbon — `calculateTradeTargetAmount` (view).
 * Uses the action's tradeActions as-is (caller must provide valid strategy IDs + amounts).
 */
function quoteCarbon(action: CarbonSwapAction): QuoteCall {
  const to = at(action.controller);
  const data = concatHex(
    sel("calculateTradeTargetAmount(address,address,(uint256,uint128)[])"),
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        {
          type: "tuple[]",
          components: [
            { type: "uint256", name: "strategyId" },
            { type: "uint128", name: "amount" },
          ],
        },
      ],
      [
        at(action.sourceToken),
        at(action.targetToken),
        action.tradeActions.map((ta) => ({
          strategyId: BigInt(ta.strategyId),
          amount: BigInt(ta.amount),
        })),
      ],
    ),
  );
  return { to, data, decode: decodeUint256, toSauce: asUint256("static", to, data) };
}

/**
 * DODO V2 — `querySellBase` / `querySellQuote` (view) on the pool, the side `@sauce/router`'s `dodoV2`
 * takes: selling base when `tokenIn` is the base token. Every DODO V2 pool returns the amount first.
 */
function quoteDodoV2(action: DodoV2SwapAction, amountIn: bigint): QuoteCall {
  const sellingBase = BigInt(action.tokenIn) === BigInt(action.baseToken);
  const to = at(action.pool);
  const data = concatHex(
    sel(sellingBase ? "querySellBase(address,uint256)" : "querySellQuote(address,uint256)"),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ZERO_ADDR, amountIn]),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // DVM returns (receiveAmount, mtFee); DPP and DSP append more words.
      const [receiveAmount] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        result,
      );
      return receiveAmount;
    },
    toSauce: asUint256("static", to, data),
    // selector(4) + trader(32) = 36
    toSauceDynamic: makeDynamic("static", to, data, 36, OUT_UINT256, firstWord),
  };
}

/** DODO V1 — the first pair of the route, quoted by `quoteDODOV1`. */
function quoteDodoV1(action: DodoV1SwapAction, amountIn: bigint): QuoteCall {
  return quoteDODOV1(getAddress(action.pairs[0]!), (action.directions & 1) === 0, amountIn);
}

/**
 * Trader Joe LB — `getSwapOut(amountIn, swapForY)` (view) on the pair. A pair that would leave part
 * of the input unspent quotes zero: `@sauce/router`'s `traderJoeLB` swap reverts there
 * (`LBPair__OutOfLiquidity`) rather than fill it partly.
 */
function quoteTraderJoeLB(action: TraderJoeLBSwapAction, amountIn: bigint): QuoteCall {
  const swapForY = BigInt(at(action.tokenIn)) === BigInt(at(action.tokenX));
  const to = at(action.pool);
  const data = concatHex(
    sel("getSwapOut(uint128,bool)"),
    encodeAbiParameters([{ type: "uint128" }, { type: "bool" }], [amountIn, swapForY]),
  );
  // (uint128 amountInLeft, uint128 amountOut, uint128 fee): the output, or 0 when input is left.
  const filled: Extract = (emit, decoded) => {
    const left = bindConst(emit, "qleft", `${decoded.expr}[0]`);
    return {
      stmts: [...decoded.stmts, ...left.stmts],
      expr: `${left.expr} == 0n ? ${decoded.expr}[1] : 0n`,
    };
  };
  return {
    to,
    data,
    decode: (result: Hex) => {
      const [left, out] = decodeAbiParameters(
        [{ type: "uint128" }, { type: "uint128" }, { type: "uint128" }],
        result,
      );
      return left === 0n ? out : 0n;
    },
    toSauce: staticQuote("static", to, data, words(3), filled),
    // selector(4), then the amount is the first head slot.
    toSauceDynamic: makeDynamic("static", to, data, 4, words(3), filled),
  };
}

/** WOOFi — the WooPPV2's own `query(fromToken, toToken, fromAmount)` (view). */
function quoteWoofi(action: WoofiSwapAction, amountIn: bigint): QuoteCall {
  const to = at(action.pool);
  const data = concatHex(
    sel("query(address,address,uint256)"),
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [at(action.tokenIn), at(action.tokenOut), amountIn],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + fromToken(32) + toToken(32) = 68
    toSauceDynamic: makeDynamic("static", to, data, 68, OUT_UINT256, firstWord),
  };
}

/**
 * DODO V1 Classical pair — `querySellBaseToken(uint256)` (view). V1 pairs have no `querySellBase`,
 * which is V2's, so a V1 action quoted through it reverted. A V1 pair prices only a BASE sale this
 * way; selling the quote token is a `buyBaseToken` the pair cannot quote by input amount.
 */
function quoteDODOV1(pool: Address, sellingBase: boolean, amountIn: bigint): QuoteCall {
  if (!sellingBase) {
    throw new Error(
      "a DODO V1 pair quotes only a base-token sale by input amount " +
        "(querySellBaseToken); this action sells the quote token",
    );
  }
  const to = pool;
  const data = concatHex(
    sel("querySellBaseToken(uint256)"),
    encodeAbiParameters([{ type: "uint256" }], [amountIn]),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4), then the amount is the first head slot.
    toSauceDynamic: makeDynamic("static", to, data, 4, OUT_UINT256, firstWord),
  };
}

// ---------------------------------------------------------------------------
// Separate quoter / resolver contracts
// ---------------------------------------------------------------------------

/** The Sauce Router's `quote(QuoteParams)`: a swap it simulates and reverts, needing no tokens. */
const ROUTER_QUOTE = parseAbiItem(
  "function quote((uint8 poolType, address pool, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, address stateView, address tokenIn, address tokenOut, int256 amountSpecified, uint160 sqrtPriceLimitX96) params) returns ((uint256 amountIn, uint256 amountOut, uint160 sqrtPriceAfter, uint256 gasEstimate) result)",
) as AbiFunction;

/** A sentinel amount, planted to find where the amount word sits in the encoded quote. */
const AMOUNT_SENTINEL = (1n << 254n) + 0x5a0cen;

/**
 * Uniswap V3 and V4 — the Router's own `quote`, which runs the swap the action's `@sauce/router`
 * call runs (`swapV3`, `swapV4`) and reverts it, without tokens. V3 takes the exact input positive
 * and V4 negative, the signs the swap passes; the V4 pool key is the action's tokens in sort order.
 */
function quoteThroughRouter(
  action: UniswapV3SwapAction | UniswapV4SwapAction,
  amountIn: bigint,
  router: Address,
): QuoteCall {
  const v4 = action.type === "uniswapV4Swap";
  const [c0, c1] =
    BigInt(action.tokenIn) < BigInt(action.tokenOut)
      ? [action.tokenIn, action.tokenOut]
      : [action.tokenOut, action.tokenIn];
  const encode = (amountSpecified: bigint): Hex =>
    callData(ROUTER_QUOTE, [
      {
        poolType: v4 ? 2 : 1,
        pool: v4 ? action.poolManager : action.pool,
        poolKey: v4
          ? {
              currency0: c0,
              currency1: c1,
              fee: action.fee,
              tickSpacing: action.tickSpacing,
              hooks: action.hooks ?? ZERO_ADDR,
            }
          : {
              currency0: ZERO_ADDR,
              currency1: ZERO_ADDR,
              fee: 0,
              tickSpacing: 0,
              hooks: ZERO_ADDR,
            },
        stateView: ZERO_ADDR,
        tokenIn: action.tokenIn,
        tokenOut: action.tokenOut,
        amountSpecified,
        sqrtPriceLimitX96: BigInt(action.sqrtPriceLimitX96 ?? 0),
      },
    ]);
  const data = encode(v4 ? -amountIn : amountIn);
  // The amount's word, found rather than counted: a static struct, so it has a fixed offset.
  const probe = encode(AMOUNT_SENTINEL).slice(2);
  const at = probe.indexOf(AMOUNT_SENTINEL.toString(16).padStart(64, "0"));
  if (at < 0 || at % 2 !== 0) throw new Error("quote: the Router quote's amount word moved");
  const offset = at / 2;
  const dynamic = makeDynamic("call", router, data, offset, words(4), nthWord(1));

  return {
    to: router,
    data,
    // SwapQuoteResult (amountIn, amountOut, sqrtPriceAfter, gasEstimate): the output is the second.
    decode: (result: Hex) => (returned(ROUTER_QUOTE, result)[0] as { amountOut: bigint }).amountOut,
    toSauce: asTupleFieldUint256("call", router, data, 4, 1),
    toSauceDynamic: v4 ? (emit, amountExpr) => dynamic(emit, `-(${amountExpr})`) : dynamic,
  };
}

/**
 * Maverick V2 — MaverickV2Quoter `calculateSwap` (revert-sim), over the full tick range the
 * Router's swap uses. A Maverick V2 pool's token A is its lower-addressed token, so selling A is
 * `tokenIn < tokenOut`.
 *
 * calculateSwap(IMaverickV2Pool pool, uint128 amount, bool tokenAIn, bool exactOutput, int32 tickLimit)
 *   → (uint256 amountIn, uint256 amountOut, uint256 gasEstimate)
 */
function quoteMaverickV2(
  action: MaverickV2SwapAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const tokenAIn = BigInt(action.tokenIn) < BigInt(action.tokenOut);
  const to = quoter;
  const data = concatHex(
    sel("calculateSwap(address,uint128,bool,bool,int32)"),
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint128" },
        { type: "bool" },
        { type: "bool" },
        { type: "int32" },
      ],
      // No tick limit, as the Router's swap applies none: the extreme tick in the swap's direction
      // (up when selling token A).
      [at(action.pool), amountIn, tokenAIn, false, tokenAIn ? 2 ** 31 - 1 : -(2 ** 31)],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      const [, amountOut] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        result,
      );
      return amountOut;
    },
    toSauce: asTupleFieldUint256("call", to, data, 3, 1),
    // selector(4) + pool(32) = 36; output = (uint256, uint256, uint256), take index 1.
    toSauceDynamic: makeDynamic("call", to, data, 36, words(3), nthWord(1)),
  };
}

/**
 * Ambient — CrocImpact `calcImpact` (view).
 *
 * Returns (int128 baseFlow, int128 quoteFlow, uint128 finalPrice).
 * Negative flow = tokens leaving pool to user (output).
 */
function quoteAmbient(action: AmbientSwapAction, amountIn: bigint, impact: Address): QuoteCall {
  const to = impact;
  const data = concatHex(
    sel("calcImpact(address,address,uint256,bool,bool,uint128,uint16,uint128)"),
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bool" },
        { type: "bool" },
        { type: "uint128" },
        { type: "uint16" },
        { type: "uint128" },
      ],
      [
        at(action.base),
        at(action.quote),
        BigInt(action.poolIdx),
        action.isBuy,
        action.inBaseQty,
        amountIn,
        action.tip,
        BigInt(action.limitPrice),
      ],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (int128 baseFlow, int128 quoteFlow, uint128 finalPrice)
      // Negative flow = tokens leaving pool to user (output).
      // Pick whichever flow is negative as the output amount.
      const [baseFlow, quoteFlow] = decodeAbiParameters(
        [{ type: "int128" }, { type: "int128" }, { type: "uint128" }],
        result,
      );
      if (baseFlow < 0n) return -baseFlow;
      if (quoteFlow < 0n) return -quoteFlow;
      return 0n;
    },
    toSauce: asAmbientFlow("static", to, data),
    // selector(4) + base(32) + quote(32) + poolIdx(32) + isBuy(32) + inBaseQty(32) = 164
    toSauceDynamic: makeDynamic("static", to, data, 164, AMBIENT_OUTPUT, ambientFlow),
  };
}

/**
 * Fluid DEX T1 — DexReservesResolver `estimateSwapIn` (revert-sim).
 *
 * estimateSwapIn(address dex_, bool swap0to1_, uint256 amountIn_, uint256 amountOutMin_)
 *   → uint256 amountOut_
 */
function quoteFluidT1(
  action: FluidDexT1SwapAction,
  amountIn: bigint,
  resolver: Address,
): QuoteCall {
  const to = resolver;
  const data = concatHex(
    sel("estimateSwapIn(address,bool,uint256,uint256)"),
    encodeAbiParameters(
      [{ type: "address" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [at(action.pool), action.swap0to1, amountIn, 0n],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("call", to, data),
    // selector(4) + dex(32) + swap0to1(32) = 68
    toSauceDynamic: makeDynamic("call", to, data, 68, OUT_UINT256, firstWord),
  };
}
