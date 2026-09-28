/**
 * Swap actions -> quote calls, both off-chain (`eth_call`) and on-chain.
 *
 * The off-chain half (`to`, `data`, `decode`) never touched a compiler and is unchanged. The
 * on-chain half emitted `Saucer` builder nodes against the retired TypeScript compiler; it now
 * emits SauceScript statements plus the `uint256` expression they leave available (a
 * [`Fragment`]), because the Rust compiler's only surface is `compile()` over source text.
 *
 * The four return SHAPES the retired `OutputSpec` described map onto `abi.decode` shape strings —
 * see [`Shape`]. Everything else about a quote (target, selector, arguments, amount offsets) is
 * byte-for-byte what it was.
 */
import { keccak256, toBytes, encodeAbiParameters, decodeAbiParameters, getAddress } from "viem";

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

import type {
  SwapAction,
  UniswapV3ExactInputAction,
  UniswapV3ExactInputMultiHopAction,
  UniswapV4ExactInputAction,
  UniswapV4ExactInputMultiHopAction,
  CurveSwapAction,
  CurveRouterNGSwapAction,
  BalancerV2SwapAction,
  BalancerV2BatchSwapAction,
  BalancerV3SwapAction,
  AmbientSwapAction,
  DODOSwapAction,
  MaverickSwapAction,
  MaverickMultiHopSwapAction,
  CarbonSwapAction,
  ClipperSwapAction,
  IntegralSwapAction,
  FluidDexT1SwapAction,
  FluidDexLiteSwapAction,
} from "./types.js";

type Address = `0x${string}`;
type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of compiling a swap action into a quote call. */
export interface QuoteCall {
  /** Contract to call via eth_call */
  to: Address;
  /** ABI-encoded calldata */
  data: Hex;
  /** Decode the raw eth_call result into the output amount */
  decode: (result: Hex) => bigint;
  /**
   * Emit the SauceScript that performs the on-chain quote call, plus the expression yielding the
   * output amount. Every quote extracts to a single uint256 regardless of the underlying return
   * shape.
   *
   * Absent when the protocol's quote cannot run on-chain at all, so its presence is the signal that
   * emitting it produces a program that can execute. Callers must check for it.
   *
   * BREAKING: took and returned a `Saucer`; takes an `Emitter` and returns a source [`Fragment`].
   */
  toSauce?: (emit: Emitter) => Fragment;
  /**
   * Runtime-amount variant: splices `amountExpr` into the calldata at the
   * protocol's fixed amount offset and returns the uint256 output expression.
   *
   * Only present for protocols whose quote calldata has the input amount at
   * a fixed 32-byte offset (UniV3, Curve, BalV3, Maverick, Clipper, DODO,
   * Integral, FluidT1, UniV2/Fraxswap routers). Callers that need
   * runtime-parameterised quoting (e.g. split routing) must check for this
   * field and error out if absent.
   *
   * BREAKING: took and returned `Saucer`s; takes an `Emitter` plus a SauceScript amount
   * EXPRESSION, and returns a source [`Fragment`].
   */
  toSauceDynamic?: (emit: Emitter, amountExpr: Expr) => Fragment;
}

/**
 * External contract addresses needed for quoting protocols that use a
 * separate quoter / resolver / impact contract.
 */
export interface QuoteOpts {
  /** UniswapV3 QuoterV2 address (required for uniswapV3 actions) */
  quoterV3?: Address;
  /** UniswapV4 V4Quoter address (required for uniswapV4 actions) */
  quoterV4?: Address;
  /** Maverick V2 MaverickV2Quoter address (required for maverick actions) */
  quoterMaverick?: Address;
  /** Ambient CrocImpact address (required for ambient actions) */
  impact?: Address;
  /** Integral TwapRelayer address (required for integral actions) */
  relayer?: Address;
  /** Fluid DexReservesResolver address (required for fluidDexT1 actions) */
  fluidResolver?: Address;
  /** Fluid DexLiteResolver address (required for fluidDexLite actions) */
  fluidLiteResolver?: Address;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sel(sig: string): Hex {
  return keccak256(toBytes(sig)).slice(0, 10) as Hex;
}

function concatHex(a: Hex, b: Hex): Hex {
  return (a + b.slice(2)) as Hex;
}

const decodeUint256 = (data: Hex): bigint => decodeAbiParameters([{ type: "uint256" }], data)[0];

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;

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
 *   changes (Curve `get_dy`, Balancer `queryBatchSwap` / `querySwap…`,
 *   Carbon, Clipper, DODO, Integral, UniV2/Fraxswap router `getAmountsOut`,
 *   Ambient `calcImpact`). Blocking state writes is exactly the safety
 *   property we want — the quoter target may be caller-supplied (the
 *   action's own `pool`/`vault`/`controller`/`router`/`exchange` field), so
 *   STATICCALL keeps a malicious or buggy target from re-entering or
 *   mutating state.
 *
 * - `'call'` — regular CALL with `value=0` (`evm.call`). Use for revert-simulation
 *   quoters (UniV3 QuoterV2, UniV4 V4Quoter, MaverickV2Quoter, Fluid
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

function requireOpt(value: Address | undefined, name: string): Address {
  if (!value) throw new Error(`opts.${name} is required for this action type`);
  return value;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Compile a swap action into calldata for quoting the output amount via `eth_call`.
 *
 * Every supported action resolves to a view or revert-simulation call that
 * does **not** require token balance or approvals.
 *
 * Some protocols use a separate quoter/resolver contract. Pass the relevant
 * address in {@link QuoteOpts} when quoting those protocols.
 */
export function actionToQuote(
  action: SwapAction,
  amountIn: bigint,
  opts: QuoteOpts = {},
): QuoteCall {
  switch (action.type) {
    // --- On the same contract as the action ---
    case "curveSwap":
      return quoteCurve(action, amountIn);
    case "curveRouterNGSwap":
      return quoteCurveRouterNG(action, amountIn);
    case "uniswapV2Swap":
      return quoteV2Router(action.router, action.path, amountIn);
    case "fraxswapSwap":
      return quoteFraxswap(action.router, action.path, amountIn);
    case "balancerV2Swap":
      return quoteBalV2Single(action, amountIn);
    case "balancerV2BatchSwap":
      return quoteBalV2Batch(action);
    case "balancerV3Swap":
      return quoteBalV3(action, amountIn);
    case "carbonSwap":
      return quoteCarbon(action);
    case "clipperSwap":
      return quoteClipper(action, amountIn);
    case "dodoSwap":
      return quoteDODO(action, amountIn);

    // --- Separate quoter / resolver contract ---
    case "uniswapV3ExactInput":
      return quoteUniV3Single(action, amountIn, requireOpt(opts.quoterV3, "quoterV3"));
    case "uniswapV3ExactInputMultiHop":
      return quoteUniV3Multi(action, amountIn, requireOpt(opts.quoterV3, "quoterV3"));
    case "uniswapV4ExactInput":
      return quoteUniV4Single(action, amountIn, requireOpt(opts.quoterV4, "quoterV4"));
    case "uniswapV4ExactInputMultiHop":
      return quoteUniV4Multi(action, amountIn, requireOpt(opts.quoterV4, "quoterV4"));
    case "maverickSwap":
      return quoteMaverick(action, amountIn, requireOpt(opts.quoterMaverick, "quoterMaverick"));
    case "maverickMultiHopSwap":
      return quoteMaverickMulti(
        action,
        amountIn,
        requireOpt(opts.quoterMaverick, "quoterMaverick"),
      );
    case "ambientSwap":
      return quoteAmbient(action, amountIn, requireOpt(opts.impact, "impact"));
    case "integralSwap":
      return quoteIntegral(action, amountIn, requireOpt(opts.relayer, "relayer"));
    case "fluidDexT1Swap":
      return quoteFluidT1(action, amountIn, requireOpt(opts.fluidResolver, "fluidResolver"));
    case "fluidDexLiteSwap":
      return quoteFluidLite(
        action,
        amountIn,
        requireOpt(opts.fluidLiteResolver, "fluidLiteResolver"),
      );

    default: {
      const _: never = action;
      throw new Error(`Unknown action type: ${(_ as { type: string }).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// View functions — on the same contract referenced by the action
// ---------------------------------------------------------------------------

/** Curve StableSwap / CryptoSwap pool — `get_dy(int128,int128,uint256)`. */
function quoteCurve(action: CurveSwapAction, amountIn: bigint): QuoteCall {
  const to = action.pool;
  const data = concatHex(
    sel("get_dy(int128,int128,uint256)"),
    encodeAbiParameters(
      [{ type: "int128" }, { type: "int128" }, { type: "uint256" }],
      [BigInt(action.i), BigInt(action.j), amountIn],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + int128 i(32) + int128 j(32) = 68
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

  const to = action.router;
  const data = concatHex(
    sel("get_dy(address[11],uint256[5][5],uint256,address[5])"),
    encodeAbiParameters(
      [
        { type: "address[11]" },
        { type: "uint256[5][5]" },
        { type: "uint256" },
        { type: "address[5]" },
      ],
      [route as any, swapParams.map((r) => r.map((v) => BigInt(v))) as any, amountIn, pools as any],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + address[11] (11*32) + uint256[5][5] (25*32) = 1156
    toSauceDynamic: makeDynamic("static", to, data, 1156, OUT_UINT256, firstWord),
  };
}

/** UniswapV2 / SushiSwap / Fraxswap router — `getAmountsOut(uint256,address[])`. */
function quoteV2Router(router: Address, path: Address[], amountIn: bigint): QuoteCall {
  const to = router;
  const data = concatHex(
    sel("getAmountsOut(uint256,address[])"),
    encodeAbiParameters([{ type: "uint256" }, { type: "address[]" }], [amountIn, path]),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      const [amounts] = decodeAbiParameters([{ type: "uint256[]" }], result);
      return amounts[amounts.length - 1];
    },
    toSauce: asUint256ArrayLast("static", to, data),
    // selector(4), then amountIn is the first head slot.
    toSauceDynamic: makeDynamic("static", to, data, 4, OUT_UINT256_ARRAY, arrayLast),
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
    action.vault,
    [{ poolId: action.poolId, assetInIndex: 0n, assetOutIndex: 1n, amount: amountIn }],
    [action.tokenIn, action.tokenOut],
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
    action.vault,
    action.steps.map((s) => ({
      poolId: s.poolId,
      assetInIndex: BigInt(s.assetInIndex),
      assetOutIndex: BigInt(s.assetOutIndex),
      amount: BigInt(s.amount),
    })),
    action.assets,
    lastStep.assetOutIndex,
  );
}

/** BalancerV3 — `querySwapSingleTokenExactIn`. */
function quoteBalV3(action: BalancerV3SwapAction, amountIn: bigint): QuoteCall {
  const to = action.router;
  const data = concatHex(
    sel("querySwapSingleTokenExactIn(address,address,address,uint256,bytes)"),
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [action.pool, action.tokenIn, action.tokenOut, amountIn, "0x"],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + pool(32) + tokenIn(32) + tokenOut(32) = 100
    toSauceDynamic: makeDynamic("static", to, data, 100, OUT_UINT256, firstWord),
  };
}

/**
 * Carbon — `calculateTradeTargetAmount` (view).
 * Uses the action's tradeActions as-is (caller must provide valid strategy IDs + amounts).
 */
function quoteCarbon(action: CarbonSwapAction): QuoteCall {
  const to = action.controller;
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
        action.sourceToken,
        action.targetToken,
        action.tradeActions.map((ta) => ({
          strategyId: BigInt(ta.strategyId),
          amount: BigInt(ta.amount),
        })),
      ],
    ),
  );
  return { to, data, decode: decodeUint256, toSauce: asUint256("static", to, data) };
}

/** Clipper — `getSellQuote` (view). On-chain FMM estimate; actual execution uses signed off-chain quotes. */
function quoteClipper(action: ClipperSwapAction, amountIn: bigint): QuoteCall {
  const to = action.exchange;
  const data = concatHex(
    sel("getSellQuote(address,address,uint256)"),
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [action.inputToken, action.outputToken, amountIn],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + tokenIn(32) + tokenOut(32) = 68
    toSauceDynamic: makeDynamic("static", to, data, 68, OUT_UINT256, firstWord),
  };
}

/**
 * DODO V2 — `querySellBase` / `querySellQuote` (view) on the pool.
 *
 * The `directions` bitmask in the action encodes the swap direction:
 * bit 0 = 0 → selling base (querySellBase), bit 0 = 1 → selling quote (querySellQuote).
 * Only single-hop is supported via view; multi-hop falls back to first pool.
 */
function quoteDODO(action: DODOSwapAction, amountIn: bigint): QuoteCall {
  const pool = getAddress(action.dodoPairs[0]);
  const sellingBase = (action.directions & 1) === 0;
  if (action.version === "v1") return quoteDODOV1(pool, sellingBase, amountIn);
  const fnSel = sellingBase
    ? sel("querySellBase(address,uint256)")
    : sel("querySellQuote(address,uint256)");

  const to = pool;
  const data = concatHex(
    fnSel,
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ZERO_ADDR, amountIn]),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // Returns (uint256 receiveAmount, uint256 mtFee)
      const [receiveAmount] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        result,
      );
      return receiveAmount;
    },
    toSauce: asUint256("static", to, data),
    // selector(4) + sender/zero(32) = 36
    toSauceDynamic: makeDynamic("static", to, data, 36, OUT_UINT256, firstWord),
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
      "actionToQuote: a DODO V1 pair quotes only a base-token sale by input amount " +
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

/** UniswapV3 single-pool — QuoterV2 `quoteExactInputSingle` (revert-sim). */
function quoteUniV3Single(
  action: UniswapV3ExactInputAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const to = quoter;
  const data = concatHex(
    sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))"),
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "tokenIn" },
            { type: "address", name: "tokenOut" },
            { type: "uint256", name: "amountIn" },
            { type: "uint24", name: "fee" },
            { type: "uint160", name: "sqrtPriceLimitX96" },
          ],
        },
      ],
      [
        {
          tokenIn: action.tokenIn,
          tokenOut: action.tokenOut,
          amountIn,
          fee: action.fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
      const [amountOut] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
        result,
      );
      return amountOut;
    },
    toSauce: asUint256("call", to, data),
    // Struct args: selector(4) + tokenIn(32) + tokenOut(32) = 68
    toSauceDynamic: makeDynamic("call", to, data, 68, OUT_UINT256, firstWord),
  };
}

/** UniswapV3 multi-hop — QuoterV2 `quoteExactInput` (revert-sim). */
function quoteUniV3Multi(
  action: UniswapV3ExactInputMultiHopAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const to = quoter;
  const data = concatHex(
    sel("quoteExactInput(bytes,uint256)"),
    encodeAbiParameters([{ type: "bytes" }, { type: "uint256" }], [action.path, amountIn]),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)
      const [amountOut] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint160[]" }, { type: "uint32[]" }, { type: "uint256" }],
        result,
      );
      return amountOut;
    },
    toSauce: asUint256("call", to, data),
    // selector(4) + path_offset_pointer(32) = 36 (amount is the 2nd head slot; path tail follows)
    toSauceDynamic: makeDynamic("call", to, data, 36, OUT_UINT256, firstWord),
  };
}

/**
 * UniswapV4 single-pool — V4Quoter `quoteExactInputSingle` (revert-sim).
 *
 * QuoteExactSingleParams: { PoolKey poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData }
 * PoolKey: { Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, address hooks }
 */
function quoteUniV4Single(
  action: UniswapV4ExactInputAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const to = quoter;
  const data = concatHex(
    // One struct parameter: `quoteExactInputSingle(((address,address,uint24,int24,address),bool,
    // uint128,bytes))`. An extra pair of parentheses here hashed a different signature, and every
    // V4 quote reverted.
    sel("quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))"),
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              type: "tuple",
              name: "poolKey",
              components: [
                { type: "address", name: "currency0" },
                { type: "address", name: "currency1" },
                { type: "uint24", name: "fee" },
                { type: "int24", name: "tickSpacing" },
                { type: "address", name: "hooks" },
              ],
            },
            {
              type: "bool",
              name: "zeroForOne",
            },
            {
              type: "uint128",
              name: "exactAmount",
            },
            {
              type: "bytes",
              name: "hookData",
            },
          ],
        },
      ],
      [
        {
          poolKey: {
            currency0: action.poolKey.currency0,
            currency1: action.poolKey.currency1,
            fee: action.poolKey.fee,
            tickSpacing: action.poolKey.tickSpacing,
            hooks: action.poolKey.hooks,
          },
          zeroForOne: action.zeroForOne,
          exactAmount: amountIn,
          hookData: "0x" as Hex,
        },
      ],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 amountOut, uint256 gasEstimate)
      const [amountOut] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], result);
      return amountOut;
    },
    toSauce: asUint256("call", to, data),
  };
}

/**
 * UniswapV4 multi-hop — V4Quoter `quoteExactInput` (revert-sim).
 *
 * QuoteExactParams: { Currency exactCurrency, PathKey[] path, uint128 exactAmount }
 * PathKey: { address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData }
 */
function quoteUniV4Multi(
  action: UniswapV4ExactInputMultiHopAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const to = quoter;
  const data = concatHex(
    sel("quoteExactInput((address,(address,uint24,int24,address,bytes)[],uint128))"),
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              type: "address",
              name: "exactCurrency",
            },
            {
              type: "tuple[]",
              name: "path",
              components: [
                { type: "address", name: "intermediateCurrency" },
                { type: "uint24", name: "fee" },
                { type: "int24", name: "tickSpacing" },
                { type: "address", name: "hooks" },
                { type: "bytes", name: "hookData" },
              ],
            },
            {
              type: "uint128",
              name: "exactAmount",
            },
          ],
        },
      ],
      [
        {
          exactCurrency: action.currencyIn,
          path: action.path.map((step) => ({
            intermediateCurrency: step.intermediateCurrency,
            fee: step.fee,
            tickSpacing: step.tickSpacing,
            hooks: step.hooks,
            hookData: "0x" as Hex,
          })),
          exactAmount: amountIn,
        },
      ],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 amountOut, uint256 gasEstimate)
      const [amountOut] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], result);
      return amountOut;
    },
    toSauce: asUint256("call", to, data),
  };
}

/**
 * Maverick V2 single swap — MaverickV2Quoter `calculateSwap` (revert-sim).
 *
 * calculateSwap(IMaverickV2Pool pool, uint128 amount, bool tokenAIn, bool exactOutput, int32 tickLimit)
 *   → (uint256 amountIn, uint256 amountOut, uint256 gasEstimate)
 */
function quoteMaverick(action: MaverickSwapAction, amountIn: bigint, quoter: Address): QuoteCall {
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
      // No tick limit, as the router's own swap applies none: the extreme tick in the swap's
      // direction (up when selling token A). A limit of 0 cut a quote short on any pool whose
      // active tick was not straddling 0, and reverted it on the far side.
      [action.pool, amountIn, action.tokenAIn, false, action.tokenAIn ? 2 ** 31 - 1 : -(2 ** 31)],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 amountIn, uint256 amountOut, uint256 gasEstimate)
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

/** Maverick V2 multi-hop — MaverickV2Quoter `calculateMultiHopSwap` (revert-sim). */
function quoteMaverickMulti(
  action: MaverickMultiHopSwapAction,
  amountIn: bigint,
  quoter: Address,
): QuoteCall {
  const to = quoter;
  const data = concatHex(
    sel("calculateMultiHopSwap(bytes,uint256,bool)"),
    encodeAbiParameters(
      [{ type: "bytes" }, { type: "uint256" }, { type: "bool" }],
      [action.path, amountIn, false],
    ),
  );
  return {
    to,
    data,
    decode: (result: Hex) => {
      // (uint256 returnAmount, uint256 gasEstimate)
      const [returnAmount] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        result,
      );
      return returnAmount;
    },
    toSauce: asUint256("call", to, data),
    // selector(4) + path_offset_pointer(32) = 36 (2nd head slot is amount)
    toSauceDynamic: makeDynamic("call", to, data, 36, OUT_UINT256, firstWord),
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
        action.base,
        action.quote,
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

/** Integral SIZE — TwapRelayer `quoteSell` (view). */
function quoteIntegral(action: IntegralSwapAction, amountIn: bigint, relayer: Address): QuoteCall {
  const to = relayer;
  const data = concatHex(
    sel("quoteSell(address,address,uint256)"),
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [action.tokenIn, action.tokenOut, amountIn],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("static", to, data),
    // selector(4) + tokenIn(32) + tokenOut(32) = 68
    toSauceDynamic: makeDynamic("static", to, data, 68, OUT_UINT256, firstWord),
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
      [action.pool, action.swap0to1, amountIn, 0n],
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

/**
 * Fluid DEX Lite — FluidDexLiteResolver `estimateSwapSingle` (revert-sim).
 *
 * estimateSwapSingle(DexKey dexKey_, bool swap0To1_, int256 amountSpecified_)
 *   → uint256 amountUnspecified_
 * DexKey = (address token0, address token1, bytes32 salt)
 * Positive amountSpecified = exact input.
 */
function quoteFluidLite(
  action: FluidDexLiteSwapAction,
  amountIn: bigint,
  resolver: Address,
): QuoteCall {
  const to = resolver;
  const data = concatHex(
    sel("estimateSwapSingle((address,address,bytes32),bool,int256)"),
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "token0" },
            { type: "address", name: "token1" },
            { type: "bytes32", name: "salt" },
          ],
        },
        { type: "bool" },
        { type: "int256" },
      ],
      [
        { token0: action.token0, token1: action.token1, salt: action.salt },
        action.swap0To1,
        amountIn, // positive = exact input
      ],
    ),
  );
  return {
    to,
    data,
    decode: decodeUint256,
    toSauce: asUint256("call", to, data),
    // selector(4) + DexKey(3*32) + bool(32) = 132
    toSauceDynamic: makeDynamic("call", to, data, 132, OUT_UINT256, firstWord),
  };
}
