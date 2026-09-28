/**
 * Routing actions -> a SauceScript program, compiled by the published Rust/wasm compiler.
 *
 * Every protocol call is an ABI binding, `IBinding.at(target).method(args)`, the same shape an SDK
 * route body lowers to: the compiler derives the selector and the argument encoding from the ABI,
 * so this module computes neither. The ABIs come from the SDK's protocol registry wherever it has
 * the exact function, and `abis.ts` records, per method, why not where it does not. Struct
 * arguments are object literals keyed by the ABI's component names, which the compiler orders.
 *
 * Two kinds of call stay raw `evm.call`, each for a stated reason:
 *
 *   - a call carrying native value (`valueCall`), because a binding cannot attach value;
 *   - none other. Uniswap V4's router input and Balancer's `batchSwap` used to be pre-encoded host
 *     side and spliced; both are now encoded in the program, so a chained amount reaches them.
 *
 * A method's output is declared, and so decoded, only when an action reads it — see `abis.ts` for
 * why that is what keeps a token that returns nothing (USDT) from reverting a call that succeeded.
 *
 * AMOUNTS AND OUTPUTS. An action's amount is, in order of precedence, its explicit amount field, the
 * local an earlier action saved under `amountRef`, or the previous action's output. An action's
 * output is a REALIZED amount for a swap (the router's return, or a balance delta where the return
 * is not an amount) and for an Aave withdrawal, the value read for a source action, and otherwise
 * the input amount passed through. When an output is consumed the action delivers it to the
 * executing account (`ctx.self()`), so the next action can spend it.
 */
import {
  bindBytes,
  bindConst,
  encodeArgs,
  fn,
  hexToBytes,
  indent,
  newEmitter,
  slotVar,
  type Emitter,
  type Expr,
  type Stmt,
} from "./emit.js";
import {
  contractsFor,
  methodSelector,
  type ActionContracts,
  type BindingName,
  type MethodName,
} from "./abis.js";
import { compileEvm } from "./compile.js";
import { assertActionsSemantics, consumesPrevious, explicitAmountOf } from "./semantics.js";

import type {
  RoutingAction,
  Recipient,
  UniswapV3ExactInputAction,
  UniswapV3ExactInputMultiHopAction,
  UniswapV4ExactInputAction,
  UniswapV4ExactInputMultiHopAction,
  CurveSwapAction,
  CurveRouterNGSwapAction,
  BalancerV2SwapAction,
  BalancerV2BatchSwapAction,
  BalancerV3SwapAction,
  UniswapV2SwapAction,
  AmbientSwapAction,
  DODOSwapAction,
  MaverickSwapAction,
  MaverickMultiHopSwapAction,
  CarbonSwapAction,
  FraxswapSwapAction,
  ClipperSwapAction,
  IntegralSwapAction,
  FluidDexT1SwapAction,
  FluidDexLiteSwapAction,
  AcrossBridgeAction,
  StargateBridgeAction,
  CCTPBridgeAction,
  HyperlaneBridgeAction,
  WrapETHAction,
  UnwrapETHAction,
  WrapStETHAction,
  UnwrapStETHAction,
  LidoStakeAction,
  LidoUnstakeAction,
  RocketPoolStakeAction,
  RocketPoolUnstakeAction,
  CoinbaseStakeAction,
  EtherFiStakeAction,
  AaveV3SupplyAction,
  AaveV3WithdrawAction,
  AaveV3BorrowAction,
  AaveV3RepayAction,
  CompoundV3SupplyAction,
  CompoundV3WithdrawAction,
  TransferAction,
  ApproveAction,
  BalanceOfAction,
  ArgumentAction,
} from "./types.js";

/** V4 ActionConstants.CONTRACT_BALANCE — signals the router to use its own token balance. */
const V4_CONTRACT_BALANCE = 1n << 255n;

/**
 * V4 ActionConstants.OPEN_DELTA — a TAKE of this amount takes everything owed. It is ZERO: the
 * all-ones word this used to be overflows the router's `uint128` cast and reverts every swap.
 */
const V4_OPEN_DELTA = 0n;

/** type(int256).max — Balancer's "no limit" for an asset the Vault may take. */
const MAX_INT256 = (1n << 255n) - 1n;

const ZERO = "0n";
const SELF = "ctx.self()";
const MSG_SENDER = "ctx.msgSender()";

/** An integer field, as the decimal literal the emitted source carries. */
function word(value: string | number | bigint): Expr {
  return `${BigInt(value).toString()}n`;
}

/** An address as a hex literal, so the emitted source reads like the addresses it was built from. */
function addr(value: string | bigint): Expr {
  return `0x${BigInt(value).toString(16).padStart(40, "0")}n`;
}

/** A recipient field: an address, or the executing account for `"self"`. */
function recipient(value: Recipient): Expr {
  return value === "self" ? SELF : addr(value);
}

/** A bytes32 field (a pool id, a salt, a padded recipient). */
function b32(value: string): Expr {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}n`;
}

function flag(value: boolean): Expr {
  return value ? "true" : "false";
}

/** An object literal: the ABI component names order the fields, so their order here is free. */
function record(fields: Record<string, Expr>): Expr {
  return `{ ${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")} }`;
}

function list(elements: readonly Expr[]): Expr {
  return `[${elements.join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Action result type
// ---------------------------------------------------------------------------

export interface ActionResult {
  /** Statements that execute the action, in order. */
  readonly stmts: readonly Stmt[];
  /**
   * The action's output amount, as an expression valid once `stmts` have run.
   *
   * Meaningful only when `buildAction` was asked for the output (`needsOutput`). An action whose
   * return value was not requested leaves the pass-through input amount here — nothing reads it in
   * that case.
   */
  readonly output: Expr;
  /**
   * The ABI bindings `stmts` call through. Compile with `contractsFor(bindings)` as the compiler's
   * `inlineContracts` (the SDK's `compile.contracts`).
   */
  readonly bindings: readonly BindingName[];
}

/** Collects one action's statements and the bindings they name. */
class Lowering {
  readonly stmts: Stmt[] = [];
  private readonly used = new Set<BindingName>();

  constructor(readonly emit: Emitter) {}

  /** `IBinding.at(target).method(args)` — the expression, not yet a statement. */
  call<B extends BindingName>(binding: B, target: Expr, method: MethodName<B>, args: Expr[]): Expr {
    this.used.add(binding);

    return `${binding}.at(${target}).${method}(${args.join(", ")})`;
  }

  /** A call whose value nothing reads. */
  exec<B extends BindingName>(binding: B, target: Expr, method: MethodName<B>, args: Expr[]): void {
    this.stmts.push(`${this.call(binding, target, method, args)};`);
  }

  /**
   * A payable call carrying native `value`. Raw, because a binding call cannot attach value — the
   * selector is still the binding's own fragment's, and the arguments are `abi.encode`d in one
   * tuple (see `emit.ts#encodeArgs` for why the wrap is load-bearing).
   */
  valueCall<B extends BindingName>(
    binding: B,
    target: Expr,
    value: Expr,
    method: MethodName<B>,
    args: Expr[],
  ): void {
    const sel = this.bytes("sel", hexToBytes(methodSelector(binding, method)));
    const data = args.length === 0 ? sel : `${sel}.concat(${encodeArgs(args)})`;
    this.stmts.push(`evm.call(${target}, ${value}, ${data});`);
  }

  /** Bind `expr` to a fresh `const` and yield its name. */
  bind(prefix: string, expr: Expr): Expr {
    const bound = bindConst(this.emit, prefix, expr);
    this.stmts.push(...bound.stmts);

    return bound.expr;
  }

  /** Bind a byte literal. A method call's receiver must be an identifier, so bytes are bound. */
  bytes(prefix: string, value: Uint8Array): Expr {
    const bound = bindBytes(this.emit, prefix, value);
    this.stmts.push(...bound.stmts);

    return bound.expr;
  }

  /** The executing account's balance of `token`, as a bound local. */
  selfBalance(token: Expr): Expr {
    return this.bind("bal", this.call("IErc20", token, "balanceOf", [SELF]));
  }

  result(output: Expr): ActionResult {
    return { stmts: this.stmts, output, bindings: [...this.used] };
  }
}

/** A call whose declared output is the action's output when `needsOutput`. */
function captured(l: Lowering, needsOutput: boolean, call: Expr, passThrough: Expr): ActionResult {
  if (!needsOutput) {
    l.stmts.push(`${call};`);
    return l.result(passThrough);
  }

  return l.result(l.bind("amt", call));
}

/**
 * Runs `swap` between a pre/post `balanceOf(ctx.self())` snapshot of `token` and returns the DELTA
 * as the output — for a venue whose return is not an amount (an array, a signed pair, `bytes`, or
 * nothing). The swap must deliver to `ctx.self()` for the delta to mean anything, which every
 * caller arranges whenever `needsOutput` is set.
 */
function balanceDelta(
  l: Lowering,
  needsOutput: boolean,
  token: Expr,
  swap: () => void,
  passThrough: Expr,
): ActionResult {
  if (!needsOutput) {
    swap();
    return l.result(passThrough);
  }
  const pre = l.selfBalance(token);
  swap();
  const post = l.selfBalance(token);

  return l.result(l.bind("delta", `${post} - ${pre}`));
}

// ---------------------------------------------------------------------------
// Program assembly
// ---------------------------------------------------------------------------

/** A program's parts, before it is rendered for a standalone compile or a route body. */
export interface AssembledActions {
  readonly body: readonly Stmt[];
  readonly contracts: ActionContracts;
  /** Runtime entry parameters (`argument` actions), in the order `main` declares them. */
  readonly parameters: readonly string[];
}

/** The local a runtime entry argument arrives in. Prefixed like `slotVar`, for the same reasons. */
export function argumentVar(name: string): string {
  return `a_${name}`;
}

/**
 * Lowers `actions` into `main`'s body. Checks the program's chaining and chain rules first, against
 * `chainId` when given and otherwise the chain of the first action.
 */
export function assembleActions(
  actions: readonly RoutingAction[],
  chainId?: number,
): AssembledActions {
  assertActionsSemantics(actions, chainId);

  const emit = newEmitter();
  const body: Stmt[] = [];
  const bindings = new Set<BindingName>();
  const parameters: string[] = [];
  const declared = new Set<string>();
  let lastOutputSlot: string | undefined;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.type === "argument") parameters.push(action.name);

    const amountIn = resolveAmountIn(action, lastOutputSlot);
    const next = actions[i + 1];
    const needsStore =
      action.saveOutputAs !== undefined || (next !== undefined && consumesPrevious(next));

    const result = buildAction(emit, action, amountIn, needsStore);
    body.push(...result.stmts);
    for (const b of result.bindings) bindings.add(b);

    if (needsStore) {
      const slot = action.saveOutputAs === undefined ? `t_out${i}` : slotVar(action.saveOutputAs);
      body.push(
        declared.has(slot) ? `${slot} = ${result.output};` : `let ${slot} = ${result.output};`,
      );
      declared.add(slot);
      lastOutputSlot = slot;
    }
  }

  return { body, contracts: contractsFor(bindings), parameters };
}

function hasAmountRef(action: RoutingAction): boolean {
  return "amountRef" in action && action.amountRef !== undefined;
}

/**
 * The amount an action spends: its explicit amount, the named output it references, or the
 * previous action's output. Source actions spend nothing.
 */
function resolveAmountIn(action: RoutingAction, lastOutputSlot: string | undefined): Expr {
  if (action.type === "balanceOf" || action.type === "nativeBalance" || action.type === "argument")
    return ZERO;
  const explicit = explicitAmountOf(action);
  if (explicit !== undefined) return word(explicit);
  if (hasAmountRef(action)) return slotVar((action as { amountRef: string }).amountRef);
  if (lastOutputSlot !== undefined) return lastOutputSlot;
  throw new Error(
    "No amount specified: provide an explicit amount, amountRef, or chain from a previous action",
  );
}

/**
 * `main` for a standalone compile: typed parameters and a `void` return, which the compiler
 * requires to be declared.
 */
export function renderProgram(assembled: AssembledActions): string {
  const params = assembled.parameters.map((name) => `${argumentVar(name)}: Uint256`);

  return `${fn("main", params, "void", assembled.body)}\n`;
}

/**
 * `main` for an SDK route body: no annotations, because the route compiler's rewrite passes parse
 * plain JavaScript and add the `void` themselves. A route body is compiled with no arguments, so a
 * program with `argument` actions cannot be one.
 */
export function renderRouteBody(assembled: AssembledActions): string {
  if (assembled.parameters.length > 0) {
    throw new Error(
      `an intent route body takes no runtime arguments, but this program declares ` +
        `${assembled.parameters.map((p) => `'${p}'`).join(", ")}. Read the amount on-chain instead ` +
        `(a \`balanceOf\` action), or compile it standalone with \`compileActions\`.`,
    );
  }
  return `function main() {\n${indent(assembled.body)}\n}\n`;
}

/**
 * The SauceScript source for `actions`, as a standalone program. Empty for an empty list.
 *
 * The source names ABI bindings, so compiling it needs their ABIs: `actionsToProgramSource` returns
 * both, and `actionsToSauce` compiles them together.
 */
export function actionsToSauceSource(actions: readonly RoutingAction[]): string {
  if (actions.length === 0) return "";

  return renderProgram(assembleActions(actions));
}

/** The standalone source for `actions` together with the ABI bindings it compiles against. */
export function actionsToProgramSource(actions: readonly RoutingAction[]): {
  readonly source: string;
  readonly contracts: ActionContracts;
  readonly parameters: readonly string[];
} {
  const assembled = assembleActions(actions);

  return {
    source: renderProgram(assembled),
    contracts: assembled.contracts,
    parameters: assembled.parameters,
  };
}

export function actionsToSauce(actions: readonly RoutingAction[]): Uint8Array {
  if (actions.length === 0) return new Uint8Array();
  const assembled = assembleActions(actions);

  return compileEvm(renderProgram(assembled), assembled.contracts).bytecode;
}

export function actionToSauce(action: RoutingAction): Uint8Array {
  return actionsToSauce([action]);
}

/**
 * Emit the statements for one action.
 *
 * Takes an [`Emitter`] (from `newEmitter()`) and a SauceScript amount EXPRESSION, and returns source
 * statements plus the ABI bindings they name. `needsOutput` both selects the recipient
 * (`ctx.self()` when the output is consumed, the action's own `recipient` otherwise) and decides
 * whether the output is captured.
 */
export function buildAction(
  emit: Emitter,
  action: RoutingAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const l = new Lowering(emit);
  switch (action.type) {
    case "uniswapV3ExactInput":
      return uniswapV3ExactInput(l, action, amountIn, needsOutput);
    case "uniswapV3ExactInputMultiHop":
      return uniswapV3ExactInputMultiHop(l, action, amountIn, needsOutput);
    case "uniswapV4ExactInput":
      return uniswapV4ExactInput(l, action, amountIn, needsOutput);
    case "uniswapV4ExactInputMultiHop":
      return uniswapV4ExactInputMultiHop(l, action, amountIn, needsOutput);
    case "curveSwap":
      return curveSwap(l, action, amountIn, needsOutput);
    case "balancerV2Swap":
      return balancerV2Swap(l, action, amountIn, needsOutput);
    case "balancerV2BatchSwap":
      return balancerV2BatchSwap(l, action, amountIn, needsOutput);
    case "balancerV3Swap":
      return balancerV3Swap(l, action, amountIn, needsOutput);
    case "uniswapV2Swap":
      return uniswapV2Swap(l, action, amountIn, needsOutput);
    case "curveRouterNGSwap":
      return curveRouterNGSwap(l, action, amountIn, needsOutput);
    case "ambientSwap":
      return ambientSwap(l, action, amountIn, needsOutput);
    case "dodoSwap":
      return dodoSwap(l, action, amountIn, needsOutput);
    case "maverickSwap":
      return maverickSwap(l, action, amountIn, needsOutput);
    case "maverickMultiHopSwap":
      return maverickMultiHopSwap(l, action, amountIn, needsOutput);
    case "carbonSwap":
      return carbonSwap(l, action, amountIn, needsOutput);
    case "fraxswapSwap":
      return fraxswapSwap(l, action, amountIn, needsOutput);
    case "clipperSwap":
      return clipperSwap(l, action, amountIn, needsOutput);
    case "integralSwap":
      return integralSwap(l, action, amountIn, needsOutput);
    case "fluidDexT1Swap":
      return fluidDexT1Swap(l, action, amountIn, needsOutput);
    case "fluidDexLiteSwap":
      return fluidDexLiteSwap(l, action, amountIn, needsOutput);
    case "transfer":
      return transfer(l, action, amountIn);
    case "approve":
      return approve(l, action, amountIn);
    case "wrapETH":
      return wrapETH(l, action, amountIn);
    case "unwrapETH":
      return unwrapETH(l, action, amountIn);
    case "wrapStETH":
      return wrapStETH(l, action, amountIn);
    case "unwrapStETH":
      return unwrapStETH(l, action, amountIn);
    case "lidoStake":
      return lidoStake(l, action, amountIn);
    case "lidoUnstake":
      return lidoUnstake(l, action, amountIn);
    case "rocketPoolStake":
      return rocketPoolStake(l, action, amountIn);
    case "rocketPoolUnstake":
      return rocketPoolUnstake(l, action, amountIn);
    case "coinbaseStake":
      return coinbaseStake(l, action, amountIn);
    case "etherFiStake":
      return etherFiStake(l, action, amountIn);
    case "aaveV3Supply":
      return aaveV3Supply(l, action, amountIn);
    case "aaveV3Withdraw":
      return aaveV3Withdraw(l, action, amountIn, needsOutput);
    case "aaveV3Borrow":
      return aaveV3Borrow(l, action, amountIn);
    case "aaveV3Repay":
      return aaveV3Repay(l, action, amountIn);
    case "compoundV3Supply":
      return compoundV3Supply(l, action, amountIn);
    case "compoundV3Withdraw":
      return compoundV3Withdraw(l, action, amountIn);
    case "acrossBridge":
      return acrossBridge(l, action, amountIn);
    case "stargateBridge":
      return stargateBridge(l, action, amountIn);
    case "cctpBridge":
      return cctpBridge(l, action, amountIn);
    case "hyperlaneBridge":
      return hyperlaneBridge(l, action, amountIn);
    case "balanceOf":
      return balanceOf(l, action);
    case "nativeBalance":
      return l.result(l.bind("nat", "ctx.selfBalance()"));
    case "argument":
      return argument(l, action);
    default: {
      const _: never = action;
      throw new Error(`Unknown action type: ${(_ as { type: string }).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Swap actions
// ---------------------------------------------------------------------------

function uniswapV3ExactInput(
  l: Lowering,
  action: UniswapV3ExactInputAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const params = record({
    tokenIn: addr(action.tokenIn),
    tokenOut: addr(action.tokenOut),
    fee: word(action.fee),
    recipient: needsOutput ? SELF : recipient(action.recipient),
    amountIn,
    amountOutMinimum: word(action.amountOutMin ?? "0"),
    sqrtPriceLimitX96: word(action.sqrtPriceLimitX96 ?? "0"),
  });
  const call = l.call("ISwapRouter02", addr(action.router), "exactInputSingle", [params]);

  return captured(l, needsOutput, call, amountIn);
}

function uniswapV3ExactInputMultiHop(
  l: Lowering,
  action: UniswapV3ExactInputMultiHopAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const path = l.bytes("path", hexToBytes(action.path));
  const params = record({
    path,
    recipient: needsOutput ? SELF : recipient(action.recipient),
    amountIn,
    amountOutMinimum: word(action.amountOutMin),
  });
  const call = l.call("ISwapRouter02", addr(action.router), "exactInput", [params]);

  return captured(l, needsOutput, call, amountIn);
}

/**
 * Uniswap V4 through the Universal Router's `V4_SWAP` command (0x10): the input token is
 * transferred to the router, which swaps (`SWAP_EXACT_IN_SINGLE` 0x06 / `SWAP_EXACT_IN` 0x07),
 * settles from its own balance (`SETTLE` 0x0b, `payerIsUser = false`, `CONTRACT_BALANCE`) and takes
 * everything owed to the recipient (`TAKE` 0x0e, `OPEN_DELTA`).
 *
 * The router input is encoded in the program — `abi.encode(actions, params[])` inside the
 * `bytes[]` of `execute` — so the amount is a runtime value, and the TAKE recipient can be
 * `ctx.self()` when the output is chained, like every other swap. The swap parameters are ONE
 * ABI-encoded struct, head offset included, which is what the V4 router's calldata decoder reads;
 * the multi-hop struct has no `maxHopSlippage` field. Both were checked against the deployed
 * mainnet Universal Router (`v4.fork.test.ts`), where the flattened encoding this replaced reverts.
 */
function v4Execute(
  l: Lowering,
  router: string,
  currencyIn: string,
  currencyOut: string,
  amountIn: Expr,
  swapAction: 0x06 | 0x07,
  swapParams: Expr,
  to: Expr,
): void {
  l.exec("IErc20", addr(currencyIn), "transfer", [addr(router), amountIn]);
  const settle = l.bind(
    "settle",
    encodeArgs([addr(currencyIn), word(V4_CONTRACT_BALANCE), flag(false)]),
  );
  const take = l.bind("take", encodeArgs([addr(currencyOut), to, word(V4_OPEN_DELTA)]));
  const actions = l.bytes("v4actions", Uint8Array.of(swapAction, 0x0b, 0x0e));
  const input = l.bind("v4input", encodeArgs([actions, list([swapParams, settle, take])]));
  const commands = l.bytes("v4cmd", Uint8Array.of(0x10));
  l.exec("IUniversalRouter", addr(router), "execute", [commands, list([input])]);
}

function uniswapV4ExactInput(
  l: Lowering,
  action: UniswapV4ExactInputAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const { poolKey } = action;
  const currencyIn = action.zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const currencyOut = action.zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const to = needsOutput ? SELF : recipient(action.recipient);

  return balanceDelta(
    l,
    needsOutput,
    addr(currencyOut),
    () => {
      const hookData = l.bytes("hook", new Uint8Array());
      // ExactInputSingleParams { PoolKey poolKey; bool zeroForOne; uint128 amountIn;
      //                          uint128 amountOutMinimum; bytes hookData; }
      const params = l.bind(
        "v4swap",
        encodeArgs([
          record({
            poolKey: record({
              currency0: addr(poolKey.currency0),
              currency1: addr(poolKey.currency1),
              fee: word(poolKey.fee),
              tickSpacing: word(poolKey.tickSpacing),
              hooks: addr(poolKey.hooks),
            }),
            zeroForOne: flag(action.zeroForOne),
            amountIn,
            amountOutMinimum: word(action.amountOutMin),
            hookData,
          }),
        ]),
      );
      v4Execute(l, action.router, currencyIn, currencyOut, amountIn, 0x06, params, to);
    },
    amountIn,
  );
}

function uniswapV4ExactInputMultiHop(
  l: Lowering,
  action: UniswapV4ExactInputMultiHopAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const currencyOut = action.path[action.path.length - 1]!.intermediateCurrency;
  const to = needsOutput ? SELF : recipient(action.recipient);

  return balanceDelta(
    l,
    needsOutput,
    addr(currencyOut),
    () => {
      const hookData = l.bytes("hook", new Uint8Array());
      // ExactInputParams { Currency currencyIn; PathKey[] path; uint128 amountIn;
      //                    uint128 amountOutMinimum; }
      const path = list(
        action.path.map((hop) =>
          record({
            intermediateCurrency: addr(hop.intermediateCurrency),
            fee: word(hop.fee),
            tickSpacing: word(hop.tickSpacing),
            hooks: addr(hop.hooks),
            hookData,
          }),
        ),
      );
      const params = l.bind(
        "v4swap",
        encodeArgs([
          record({
            currencyIn: addr(action.currencyIn),
            path,
            amountIn,
            amountOutMinimum: word(action.amountOutMin),
          }),
        ]),
      );
      v4Execute(l, action.router, action.currencyIn, currencyOut, amountIn, 0x07, params, to);
    },
    amountIn,
  );
}

function curveSwap(
  l: Lowering,
  action: CurveSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // 3pool-era pools (e.g. 0xbEbc44…) expose only the 4-argument `exchange`, which returns nothing
  // and pays msg.sender — the executing account. The output is the `tokenOut` balance delta around
  // the call, which excludes whatever an earlier action left behind.
  const tokenOut = addr(action.tokenOut);
  const pre = l.selfBalance(tokenOut);
  l.exec("ICurvePool", addr(action.pool), "exchange", [
    word(action.i),
    word(action.j),
    amountIn,
    word(action.amountOutMin),
  ]);
  const post = l.selfBalance(tokenOut);
  const delta = l.bind("delta", `${post} - ${pre}`);

  // Not chained, and not asked to keep it: forward the delta to the recipient.
  if (!needsOutput && action.recipient !== "self") {
    l.exec("IErc20", tokenOut, "transfer", [recipient(action.recipient), delta]);
  }

  return l.result(delta);
}

function balancerV2Swap(
  l: Lowering,
  action: BalancerV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const userData = l.bytes("ud", new Uint8Array());
  const singleSwap = record({
    poolId: b32(action.poolId),
    kind: ZERO, // GIVEN_IN
    assetIn: addr(action.tokenIn),
    assetOut: addr(action.tokenOut),
    amount: amountIn,
    userData,
  });
  const funds = record({
    sender: SELF, // must be msg.sender for the Vault to pull from it
    fromInternalBalance: flag(false),
    recipient: needsOutput ? SELF : recipient(action.recipient),
    toInternalBalance: flag(false),
  });
  const call = l.call("IBalancerV2Vault", addr(action.vault), "swap", [
    singleSwap,
    funds,
    word(action.amountOutMin),
    word(action.deadline),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function balancerV2BatchSwap(
  l: Lowering,
  action: BalancerV2BatchSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // Every step's amount is a required field, so an `amountRef` could only be ignored or silently
  // override one of them. Say so rather than execute a different trade than the one written down.
  if (action.amountRef !== undefined) {
    throw new Error(
      "balancerV2BatchSwap: `amountRef` cannot be applied — every step's `amount` is set " +
        "explicitly (a later step's 0 means \"the previous step's output\"). Set `steps[0].amount`.",
    );
  }

  const userData = l.bytes("ud", new Uint8Array());
  const steps = list(
    action.steps.map((step) =>
      record({
        poolId: b32(step.poolId),
        assetInIndex: word(step.assetInIndex),
        assetOutIndex: word(step.assetOutIndex),
        amount: word(step.amount),
        userData,
      }),
    ),
  );
  // The Vault may take any amount of every asset but the last, and must pay at least
  // `amountOutMin` of the last (a negative limit is an amount the Vault pays out).
  const limits = list(
    action.assets.map((_, i) =>
      i === action.assets.length - 1 ? `-${word(action.amountOutMin)}` : word(MAX_INT256),
    ),
  );
  const funds = record({
    sender: SELF,
    fromInternalBalance: flag(false),
    recipient: needsOutput ? SELF : recipient(action.recipient),
    toInternalBalance: flag(false),
  });

  // `batchSwap` returns `int256[] assetDeltas`, signed and negative for what was received; the
  // realized output is the executing account's delta on the last step's output asset instead.
  const lastStep = action.steps[action.steps.length - 1]!;
  const assetOut = action.assets[Number(lastStep.assetOutIndex)]!;

  return balanceDelta(
    l,
    needsOutput,
    addr(assetOut),
    () =>
      l.exec("IBalancerV2Vault", addr(action.vault), "batchSwap", [
        ZERO, // GIVEN_IN
        steps,
        list(action.assets.map(addr)),
        funds,
        limits,
        word(action.deadline),
      ]),
    amountIn,
  );
}

function uniswapV2Swap(
  l: Lowering,
  action: UniswapV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // `swapExactTokensForTokens` returns `uint256[] amounts`; the output is the balance delta on the
  // last path token instead, which is what actually arrived.
  return balanceDelta(
    l,
    needsOutput,
    addr(action.path[action.path.length - 1]!),
    () =>
      l.exec("IUniswapV2Router", addr(action.router), "swapExactTokensForTokens", [
        amountIn,
        word(action.amountOutMin),
        list(action.path.map(addr)),
        needsOutput ? SELF : recipient(action.recipient),
        word(action.deadline),
      ]),
    amountIn,
  );
}

function curveRouterNGSwap(
  l: Lowering,
  action: CurveRouterNGSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const zero = "0x0000000000000000000000000000000000000000";
  const route = [...action.route];
  while (route.length < 11) route.push(zero);
  const swapParams: number[][] = action.swapParams.map((row) => [...row]);
  while (swapParams.length < 5) swapParams.push([0, 0, 0, 0, 0]);
  const pools = [...action.pools];
  while (pools.length < 5) pools.push(zero);

  const call = l.call("ICurveRouterNG", addr(action.router), "exchange", [
    list(route.map(addr)),
    list(swapParams.map((row) => list(row.map(word)))),
    amountIn,
    word(action.amountOutMin),
    list(pools.map(addr)),
    needsOutput ? SELF : recipient(action.recipient),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function balancerV3Swap(
  l: Lowering,
  action: BalancerV3SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // The V3 Router pays msg.sender — the executing account — and takes no recipient.
  const userData = l.bytes("ud", new Uint8Array());
  const call = l.call("IBalancerV3Router", addr(action.router), "swapSingleTokenExactIn", [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    word(action.deadline),
    flag(action.wethIsEth),
    userData,
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function ambientSwap(
  l: Lowering,
  action: AmbientSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // `userCmd(1, cmd)` is the swap callpath: cmd = abi.encode(base, quote, poolIdx, isBuy,
  // inBaseQty, qty, tip, limitPrice, minOut, reserveFlags). It returns `bytes`, and settles to
  // msg.sender, so the output is the delta on the received side: the quote token when buying
  // (paying base), the base token otherwise.
  const tokenOut = addr(action.isBuy ? action.quote : action.base);

  return balanceDelta(
    l,
    needsOutput,
    tokenOut,
    () => {
      const cmd = l.bind(
        "cmd",
        encodeArgs([
          addr(action.base),
          addr(action.quote),
          word(action.poolIdx),
          flag(action.isBuy),
          flag(action.inBaseQty),
          amountIn,
          word(action.tip),
          word(action.limitPrice),
          word(action.minOut),
          word(action.reserveFlags),
        ]),
      );
      l.exec("ICrocSwapDex", addr(action.dex), "userCmd", ["1n", cmd]);
    },
    amountIn,
  );
}

function dodoSwap(
  l: Lowering,
  action: DODOSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // The proxy pays msg.sender and returns the amount it paid. `version: "v1"` routes legacy
  // Classical pairs through `dodoSwapV1`; allowances go to DODOApprove, not to the proxy.
  const args = [
    addr(action.fromToken),
    addr(action.toToken),
    amountIn,
    word(action.amountOutMin),
    list(action.dodoPairs.map(addr)),
    word(action.directions),
    flag(false), // isIncentive
    word(action.deadline),
  ];
  const call =
    action.version === "v1"
      ? l.call("IDodoProxy", addr(action.proxy), "dodoSwapV1", args)
      : l.call("IDodoProxy", addr(action.proxy), "dodoSwapV2TokenToToken", args);

  return captured(l, needsOutput, call, amountIn);
}

function maverickSwap(
  l: Lowering,
  action: MaverickSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.call("IMaverickV2Router", addr(action.router), "exactInputSingle", [
    needsOutput ? SELF : recipient(action.recipient),
    addr(action.pool),
    flag(action.tokenAIn),
    amountIn,
    word(action.amountOutMin),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function maverickMultiHopSwap(
  l: Lowering,
  action: MaverickMultiHopSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const path = l.bytes("path", hexToBytes(action.path));
  const call = l.call("IMaverickV2Router", addr(action.router), "exactInputMultiHop", [
    needsOutput ? SELF : recipient(action.recipient),
    path,
    amountIn,
    word(action.amountOutMin),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function carbonSwap(
  l: Lowering,
  action: CarbonSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // Carbon pays msg.sender, and its per-strategy amounts are the trade: the action's own amount is
  // not an argument here.
  const tradeActions = list(
    action.tradeActions.map((ta) =>
      record({ strategyId: word(ta.strategyId), amount: word(ta.amount) }),
    ),
  );
  const call = l.call("ICarbonController", addr(action.controller), "tradeBySourceAmount", [
    addr(action.sourceToken),
    addr(action.targetToken),
    tradeActions,
    word(action.deadline),
    word(action.amountOutMin),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function fraxswapSwap(
  l: Lowering,
  action: FraxswapSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // Fraxswap's router is UniswapV2-compatible for this function: same selector, same `uint256[]`
  // return, so the output is a balance delta for the same reason.
  return balanceDelta(
    l,
    needsOutput,
    addr(action.path[action.path.length - 1]!),
    () =>
      l.exec("IUniswapV2Router", addr(action.router), "swapExactTokensForTokens", [
        amountIn,
        word(action.amountOutMin),
        list(action.path.map(addr)),
        needsOutput ? SELF : recipient(action.recipient),
        word(action.deadline),
      ]),
    amountIn,
  );
}

function clipperSwap(
  l: Lowering,
  action: ClipperSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // Clipper swaps tokens already transferred to the exchange, so the amount is not an argument;
  // `auxiliaryData` carries Clipper's signed quote.
  const aux = l.bytes("aux", hexToBytes(action.auxiliaryData));
  const call = l.call("IClipperExchange", addr(action.exchange), "sellTokenForToken", [
    addr(action.inputToken),
    addr(action.outputToken),
    needsOutput ? SELF : recipient(action.recipient),
    word(action.amountOutMin),
    aux,
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function integralSwap(
  l: Lowering,
  action: IntegralSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // `sell` returns an order id and Integral executes the order LATER, so there is no output in
  // this transaction to chain from.
  if (needsOutput) {
    throw new Error(
      "integralSwap: Integral is a delayed-order venue — `sell` returns an orderId and the swap " +
        "executes in a later transaction, so this action has no output amount to chain from. " +
        "Give the next action an explicit amount or an amountRef to a different action.",
    );
  }
  l.exec("IIntegralDelay", addr(action.delay), "sell", [
    record({
      tokenIn: addr(action.tokenIn),
      tokenOut: addr(action.tokenOut),
      amountIn,
      amountOutMin: word(action.amountOutMin),
      wrapUnwrap: flag(action.wrapUnwrap),
      to: recipient(action.recipient),
      gasLimit: word(action.gasLimit),
      submitDeadline: word(action.submitDeadline),
    }),
  ]);

  return l.result(amountIn);
}

function fluidDexT1Swap(
  l: Lowering,
  action: FluidDexT1SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.call("IFluidDexT1", addr(action.pool), "swapIn", [
    flag(action.swap0to1),
    amountIn,
    word(action.amountOutMin),
    needsOutput ? SELF : recipient(action.recipient),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function fluidDexLiteSwap(
  l: Lowering,
  action: FluidDexLiteSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // `swapSingle` returns a signed `(amount0, amount1)` pair; the output is the delta on the
  // received token instead. A positive `amountSpecified` is exact input.
  const tokenOut = addr(action.swap0To1 ? action.token1 : action.token0);

  return balanceDelta(
    l,
    needsOutput,
    tokenOut,
    () =>
      l.exec("IFluidDexLite", addr(action.dex), "swapSingle", [
        record({
          token0: addr(action.token0),
          token1: addr(action.token1),
          salt: b32(action.salt),
        }),
        flag(action.swap0To1),
        amountIn,
        word(action.amountOutMin),
        needsOutput ? SELF : recipient(action.recipient),
      ]),
    amountIn,
  );
}

// ---------------------------------------------------------------------------
// Transfer & approve — pass-through amount
// ---------------------------------------------------------------------------

function transfer(l: Lowering, action: TransferAction, amountIn: Expr): ActionResult {
  l.exec("IErc20", addr(action.token), "transfer", [recipient(action.to), amountIn]);

  return l.result(amountIn);
}

function approve(l: Lowering, action: ApproveAction, amountIn: Expr): ActionResult {
  l.exec("IErc20", addr(action.token), "approve", [addr(action.spender), amountIn]);

  return l.result(amountIn);
}

// ---------------------------------------------------------------------------
// Wrap / unwrap — pass-through amount
// ---------------------------------------------------------------------------

function wrapETH(l: Lowering, action: WrapETHAction, amountIn: Expr): ActionResult {
  l.valueCall("IWeth9", addr(action.weth), amountIn, "deposit", []);

  return l.result(amountIn);
}

function unwrapETH(l: Lowering, action: UnwrapETHAction, amountIn: Expr): ActionResult {
  l.exec("IWeth9", addr(action.weth), "withdraw", [amountIn]);

  return l.result(amountIn);
}

function wrapStETH(l: Lowering, action: WrapStETHAction, amountIn: Expr): ActionResult {
  l.exec("IWstEth", addr(action.wstETH), "wrap", [amountIn]);

  return l.result(amountIn);
}

function unwrapStETH(l: Lowering, action: UnwrapStETHAction, amountIn: Expr): ActionResult {
  l.exec("IWstEth", addr(action.wstETH), "unwrap", [amountIn]);

  return l.result(amountIn);
}

// ---------------------------------------------------------------------------
// Liquid staking — pass-through amount
// ---------------------------------------------------------------------------

function lidoStake(l: Lowering, action: LidoStakeAction, amountIn: Expr): ActionResult {
  l.valueCall("ILido", addr(action.stETH), amountIn, "submit", [addr(action.referral)]);

  return l.result(amountIn);
}

function lidoUnstake(l: Lowering, action: LidoUnstakeAction, amountIn: Expr): ActionResult {
  l.exec("ILidoWithdrawalQueue", addr(action.withdrawalQueue), "requestWithdrawals", [
    list([amountIn]),
    MSG_SENDER,
  ]);

  return l.result(amountIn);
}

function rocketPoolStake(l: Lowering, action: RocketPoolStakeAction, amountIn: Expr): ActionResult {
  l.valueCall("IRocketDepositPool", addr(action.depositPool), amountIn, "deposit", []);

  return l.result(amountIn);
}

function rocketPoolUnstake(
  l: Lowering,
  action: RocketPoolUnstakeAction,
  amountIn: Expr,
): ActionResult {
  l.exec("IRocketTokenReth", addr(action.rETH), "burn", [amountIn]);

  return l.result(amountIn);
}

function coinbaseStake(l: Lowering, action: CoinbaseStakeAction, amountIn: Expr): ActionResult {
  l.valueCall("ICbEth", addr(action.cbETH), amountIn, "deposit", []);

  return l.result(amountIn);
}

function etherFiStake(l: Lowering, action: EtherFiStakeAction, amountIn: Expr): ActionResult {
  l.valueCall("IEtherFiLiquidityPool", addr(action.liquidityPool), amountIn, "deposit", []);

  return l.result(amountIn);
}

// ---------------------------------------------------------------------------
// Lending / borrowing
// ---------------------------------------------------------------------------

function aaveV3Supply(l: Lowering, action: AaveV3SupplyAction, amountIn: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "supply", [
    addr(action.token),
    amountIn,
    recipient(action.onBehalfOf),
    word(action.referralCode),
  ]);

  return l.result(amountIn);
}

function aaveV3Withdraw(
  l: Lowering,
  action: AaveV3WithdrawAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // `withdraw` returns the amount actually withdrawn — the realized output.
  const call = l.call("IAaveV3Pool", addr(action.pool), "withdraw", [
    addr(action.token),
    amountIn,
    recipient(action.to),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function aaveV3Borrow(l: Lowering, action: AaveV3BorrowAction, amountIn: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "borrow", [
    addr(action.token),
    amountIn,
    word(action.interestRateMode),
    word(action.referralCode),
    recipient(action.onBehalfOf),
  ]);

  return l.result(amountIn);
}

function aaveV3Repay(l: Lowering, action: AaveV3RepayAction, amountIn: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "repay", [
    addr(action.token),
    amountIn,
    word(action.interestRateMode),
    recipient(action.onBehalfOf),
  ]);

  return l.result(amountIn);
}

function compoundV3Supply(
  l: Lowering,
  action: CompoundV3SupplyAction,
  amountIn: Expr,
): ActionResult {
  l.exec("ICometMarket", addr(action.comet), "supply", [addr(action.token), amountIn]);

  return l.result(amountIn);
}

function compoundV3Withdraw(
  l: Lowering,
  action: CompoundV3WithdrawAction,
  amountIn: Expr,
): ActionResult {
  l.exec("ICometMarket", addr(action.comet), "withdraw", [addr(action.token), amountIn]);

  return l.result(amountIn);
}

// ---------------------------------------------------------------------------
// Bridges — pass-through amount
// ---------------------------------------------------------------------------

function acrossBridge(l: Lowering, action: AcrossBridgeAction, amountIn: Expr): ActionResult {
  const message = l.bytes("msg", hexToBytes(action.message));
  l.exec("IAcrossSpokePool", addr(action.spokePool), "depositV3", [
    MSG_SENDER, // depositor
    MSG_SENDER, // recipient
    addr(action.token), // inputToken
    addr(action.token), // outputToken (the same token on the destination)
    amountIn, // inputAmount
    amountIn, // outputAmount
    word(action.destChainId),
    ZERO, // exclusiveRelayer (none)
    word(action.quoteTimestamp),
    word(action.fillDeadline),
    word(action.exclusivityDeadline),
    message,
  ]);

  return l.result(amountIn);
}

function stargateBridge(l: Lowering, action: StargateBridgeAction, amountIn: Expr): ActionResult {
  // The V1 Router's `swap(dstChainId, srcPoolId, dstPoolId, refundAddress, amountLD, minAmountLD,
  // lzTxParams, to, payload)`, paying the LayerZero fee as value. The caller is refunded and
  // receives on the destination; `to` is its 20 packed bytes, taken from the ABI word.
  const empty = l.bytes("empty", new Uint8Array());
  const word32 = l.bind("sender", encodeArgs([MSG_SENDER]));
  const to = l.bind("to", `${word32}.slice(12, 32)`);
  l.valueCall("IStargateRouter", addr(action.router), word(action.lzFee), "swap", [
    word(action.destChainId),
    word(action.srcPoolId),
    word(action.dstPoolId),
    MSG_SENDER,
    amountIn,
    word(action.amountOutMin),
    record({ dstGasForCall: ZERO, dstNativeAmount: ZERO, dstNativeAddr: empty }),
    to,
    empty,
  ]);

  return l.result(amountIn);
}

function cctpBridge(l: Lowering, action: CCTPBridgeAction, amountIn: Expr): ActionResult {
  l.exec("ICctpTokenMessenger", addr(action.tokenMessenger), "depositForBurn", [
    amountIn,
    word(action.destDomain),
    b32(action.mintRecipient),
    addr(action.token),
  ]);

  return l.result(amountIn);
}

function hyperlaneBridge(l: Lowering, action: HyperlaneBridgeAction, amountIn: Expr): ActionResult {
  const body = l.bytes("body", new Uint8Array());
  l.valueCall("IHyperlaneMailbox", addr(action.router), word(action.gasPayment), "dispatch", [
    word(action.destinationDomain),
    b32(action.token),
    body,
  ]);

  return l.result(amountIn);
}

// ---------------------------------------------------------------------------
// Source actions — produce a value
// ---------------------------------------------------------------------------

function balanceOf(l: Lowering, action: BalanceOfAction): ActionResult {
  return l.result(l.selfBalance(addr(action.token)));
}

function argument(l: Lowering, action: ArgumentAction): ActionResult {
  return l.result(argumentVar(action.name));
}
