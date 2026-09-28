/**
 * Action programs -> SauceScript, compiled by the published Rust/wasm compiler.
 *
 * Every protocol call is an ABI binding, `IBinding.at(target).method(args)`, the same shape an SDK
 * route body lowers to: the compiler derives the selector and the argument encoding from the ABI,
 * so this module computes neither. The ABIs come from the SDK's protocol registry wherever it has
 * the exact function, and `abis.ts` records, per method, why not where it does not. Struct
 * arguments are object literals keyed by the ABI's component names, which the compiler orders.
 *
 * Two kinds of call stay raw `evm.call`, each for a stated reason:
 *
 *   - an ERC-20 `approve`/`transfer` (`erc20Write`), through the SDK's `token/safe` lowering:
 *     a binding would decode the ABI's `bool` output, and a token that returns nothing (USDT)
 *     would then revert a write that succeeded — the raw call is checked the way OpenZeppelin's
 *     `SafeERC20` checks it instead;
 *   - a call carrying native value (`valueCall`), because a binding cannot attach value.
 *
 * A binding method's output is declared, and so decoded, only when an action reads it — see
 * `abis.ts`.
 *
 * AMOUNTS AND OUTPUTS. An action's amount is its `amount`, the local an earlier action saved under
 * its `amountRef`, or the previous action's output. Its output is what it delivered to the Pot
 * (`ctx.self()`) for a swap, a wrap or a stake and for an Aave withdrawal — the venue's return value
 * where that is the amount, a balance delta around the call where it is not — the value read for a
 * source action, and otherwise its own amount, passed through. An action whose output a later
 * action spends delivers to the Pot whatever its `recipient` says.
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
import { safeApproveStatements, safeTransferStatements, type WordArg } from "./registry.js";
import { consumesPrevious } from "./semantics.js";
import { ACTION_SPECS } from "./spec.js";

import type {
  Action,
  Recipient,
  RemoteRecipient,
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
  FluidDexT1SwapAction,
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
  EtherFiStakeAction,
  AaveV3SupplyAction,
  AaveV3WithdrawAction,
  AaveV3BorrowAction,
  AaveV3RepayAction,
  CompoundV3SupplyAction,
  CompoundV3WithdrawAction,
  TransferAction,
  ApproveAction,
  Permit2ApproveAction,
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

/** Aave V3's variable interest-rate mode, the only one it offers. */
const AAVE_VARIABLE_RATE = 2n;

/** CCTP V2's `minFinalityThreshold` for a standard (finalized) transfer. */
const CCTP_FINALIZED = 2000;

const ZERO = "0n";
const SELF = "ctx.self()";

/** An integer field, as the decimal literal the emitted source carries. */
function word(value: string | number | bigint): Expr {
  return `${BigInt(value).toString()}n`;
}

/** An address as a hex literal, so the emitted source reads like the addresses it was built from. */
function addr(value: string | bigint): Expr {
  return `0x${BigInt(value).toString(16).padStart(40, "0")}n`;
}

/** A recipient field: an address, or the Pot for `"self"`. */
function recipient(value: Recipient): Expr {
  return value === "self" ? SELF : addr(value);
}

/** A bytes32 field (a pool id). */
function b32(value: string): Expr {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}n`;
}

/** A recipient on another chain, as the 32-byte word bridges take: an address is left-padded. */
function remote(value: RemoteRecipient): Expr {
  return b32(value);
}

function flag(value: boolean): Expr {
  return value ? "true" : "false";
}

/** An object literal. A binding orders its fields by the ABI; `abi.encode` takes them as written. */
function record(fields: Record<string, Expr>): Expr {
  return `{ ${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")} }`;
}

function list(elements: readonly Expr[]): Expr {
  return `[${elements.join(", ")}]`;
}

// ---------------------------------------------------------------------------
// One action's lowering
// ---------------------------------------------------------------------------

export interface ActionResult {
  /** Statements that execute the action, in order. */
  readonly stmts: readonly Stmt[];
  /**
   * The action's output, as an expression valid once `stmts` have run. Meaningful only when the
   * lowering was asked for it (`needsOutput`); otherwise it is the pass-through amount, unread.
   */
  readonly output: Expr;
  /** The ABI bindings `stmts` call through. */
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
   * An ERC-20 `approve(spender, amount)` or `transfer(to, amount)` through the SDK's `token/safe`,
   * with OpenZeppelin `SafeERC20` semantics: the call is raw, so nothing is decoded on the way out,
   * and then its returndata must be empty (from a contract) or decode as an ABI word equal to 1.
   * `approve` first resets a non-zero allowance, which USDT requires. A token that refuses the
   * write reverts the program.
   */
  erc20Write(fn: "approve" | "transfer", token: Expr, first: Expr, amount: Expr): void {
    const prefix = this.emit.name("e");
    const statements =
      fn === "approve"
        ? safeApproveStatements(prefix, token, this.wordArg(first), this.wordArg(amount))
        : safeTransferStatements(prefix, token, this.wordArg(first), this.wordArg(amount));
    this.stmts.push(...statements);
  }

  /** A word `token/safe` can splice: a literal, or a local (an expression is bound to one). */
  private wordArg(expr: Expr): WordArg {
    const literal = /^(0x[0-9a-f]+|[0-9]+)n$/.exec(expr);
    if (literal) return { literal: BigInt(literal[1]!) };
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr)) return { local: expr };

    return { local: this.bind("w", expr) };
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

  /** The Pot's balance of `token`, as a bound local. */
  selfBalance(token: Expr): Expr {
    return this.bind("bal", this.call("IErc20", token, "balanceOf", [SELF]));
  }

  /** The Pot's native balance, as a bound local. */
  nativeBalance(): Expr {
    return this.bind("nat", "ctx.selfBalance()");
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
 * Runs `run` between two readings of `measure` — the Pot's balance of the token it receives — and
 * returns the DELTA as the output, for a venue whose return is not the amount received (an array,
 * a signed pair, `bytes`, shares, or nothing). The call must deliver to the Pot for the delta to
 * mean anything, which every caller arranges whenever `needsOutput` is set.
 */
function balanceDelta(
  l: Lowering,
  needsOutput: boolean,
  measure: () => Expr,
  run: () => void,
  passThrough: Expr,
): ActionResult {
  if (!needsOutput) {
    run();
    return l.result(passThrough);
  }
  const pre = measure();
  run();
  const post = measure();

  return l.result(l.bind("delta", `${post} - ${pre}`));
}

// ---------------------------------------------------------------------------
// Program assembly
// ---------------------------------------------------------------------------

/** A program's parts, before it is rendered for a standalone compile or a route body. */
export interface Lowered {
  readonly body: readonly Stmt[];
  readonly contracts: ActionContracts;
  /** Runtime arguments (`argument` actions), in the order `main` declares them. */
  readonly parameters: readonly string[];
}

/** The local a runtime argument arrives in. Prefixed like `slotVar`, for the same reasons. */
function argumentVar(name: string): string {
  return `a_${name}`;
}

/** Lowers a validated action list into `main`'s body. */
export function lowerActions(actions: readonly Action[]): Lowered {
  const emit = newEmitter();
  const body: Stmt[] = [];
  const bindings = new Set<BindingName>();
  const parameters: string[] = [];
  const declared = new Set<string>();
  let previous: string | undefined;

  actions.forEach((action, i) => {
    if (action.type === "argument") parameters.push(action.name);

    const next = actions[i + 1];
    const needsOutput =
      action.saveOutputAs !== undefined || (next !== undefined && consumesPrevious(next));

    const result = lowerAction(emit, action, amountOf(action, previous), needsOutput);
    body.push(...result.stmts);
    for (const b of result.bindings) bindings.add(b);

    if (needsOutput) {
      const slot = action.saveOutputAs === undefined ? `t_out${i}` : slotVar(action.saveOutputAs);
      body.push(
        declared.has(slot) ? `${slot} = ${result.output};` : `let ${slot} = ${result.output};`,
      );
      declared.add(slot);
      previous = slot;
    }
  });

  return { body, contracts: contractsFor(bindings), parameters };
}

/** The amount an action spends: its `amount`, the output it references, or the previous output. */
function amountOf(action: Action, previous: string | undefined): Expr {
  if (!ACTION_SPECS[action.type].spends) return ZERO;
  const { amount, amountRef } = action as { amount?: string; amountRef?: string };
  if (amount !== undefined) return word(amount);
  if (amountRef !== undefined) return slotVar(amountRef);
  if (previous !== undefined) return previous;
  throw new Error(`${action.type} has no amount — the program was not validated`);
}

/** `main` for a standalone compile: typed parameters and the `void` return the compiler requires. */
export function renderProgram(lowered: Lowered): string {
  const params = lowered.parameters.map((name) => `${argumentVar(name)}: Uint256`);

  return `${fn("main", params, "void", lowered.body)}\n`;
}

/**
 * `main` for an SDK route body: no annotations, because the route compiler's rewrite passes parse
 * plain JavaScript and add the `void` themselves. A route body is compiled with no arguments, so a
 * program with `argument` actions cannot be one.
 */
export function renderRouteBody(lowered: Lowered): string {
  if (lowered.parameters.length > 0) {
    throw new Error(
      `an intent route takes no runtime arguments, but this program declares ` +
        `${lowered.parameters.map((p) => `'${p}'`).join(", ")}. Read the amount on-chain instead ` +
        `(a \`balanceOf\` action), or compile it standalone with \`compileProgram\`.`,
    );
  }
  return `function main() {\n${indent(lowered.body)}\n}\n`;
}

/**
 * The statements for one action, spending the SauceScript expression `amount`. `needsOutput` both
 * routes the output to the Pot (instead of the action's own `recipient`) and captures it.
 */
export function lowerAction(
  emit: Emitter,
  action: Action,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  const l = new Lowering(emit);
  switch (action.type) {
    case "uniswapV3ExactInput":
      return uniswapV3ExactInput(l, action, amount, needsOutput);
    case "uniswapV3ExactInputMultiHop":
      return uniswapV3ExactInputMultiHop(l, action, amount, needsOutput);
    case "uniswapV4ExactInput":
      return uniswapV4ExactInput(l, action, amount, needsOutput);
    case "uniswapV4ExactInputMultiHop":
      return uniswapV4ExactInputMultiHop(l, action, amount, needsOutput);
    case "curveSwap":
      return curveSwap(l, action, amount, needsOutput);
    case "curveRouterNGSwap":
      return curveRouterNGSwap(l, action, amount, needsOutput);
    case "balancerV2Swap":
      return balancerV2Swap(l, action, amount, needsOutput);
    case "balancerV2BatchSwap":
      return balancerV2BatchSwap(l, action, amount, needsOutput);
    case "balancerV3Swap":
      return balancerV3Swap(l, action, amount, needsOutput);
    case "uniswapV2Swap":
      return uniswapV2Swap(l, action, amount, needsOutput);
    case "ambientSwap":
      return ambientSwap(l, action, amount, needsOutput);
    case "dodoSwap":
      return dodoSwap(l, action, amount, needsOutput);
    case "maverickSwap":
      return maverickSwap(l, action, amount, needsOutput);
    case "maverickMultiHopSwap":
      return maverickMultiHopSwap(l, action, amount, needsOutput);
    case "carbonSwap":
      return carbonSwap(l, action, amount, needsOutput);
    case "fraxswapSwap":
      return fraxswapSwap(l, action, amount, needsOutput);
    case "fluidDexT1Swap":
      return fluidDexT1Swap(l, action, amount, needsOutput);
    case "acrossBridge":
      return acrossBridge(l, action, amount);
    case "stargateBridge":
      return stargateBridge(l, action, amount);
    case "cctpBridge":
      return cctpBridge(l, action, amount);
    case "hyperlaneBridge":
      return hyperlaneBridge(l, action, amount);
    case "wrapETH":
      return wrapETH(l, action, amount);
    case "unwrapETH":
      return unwrapETH(l, action, amount);
    case "wrapStETH":
      return wrapStETH(l, action, amount, needsOutput);
    case "unwrapStETH":
      return unwrapStETH(l, action, amount, needsOutput);
    case "lidoStake":
      return lidoStake(l, action, amount, needsOutput);
    case "lidoUnstake":
      return lidoUnstake(l, action, amount);
    case "rocketPoolStake":
      return rocketPoolStake(l, action, amount, needsOutput);
    case "rocketPoolUnstake":
      return rocketPoolUnstake(l, action, amount, needsOutput);
    case "etherFiStake":
      return etherFiStake(l, action, amount, needsOutput);
    case "aaveV3Supply":
      return aaveV3Supply(l, action, amount);
    case "aaveV3Withdraw":
      return aaveV3Withdraw(l, action, amount, needsOutput);
    case "aaveV3Borrow":
      return aaveV3Borrow(l, action, amount);
    case "aaveV3Repay":
      return aaveV3Repay(l, action, amount);
    case "compoundV3Supply":
      return compoundV3Supply(l, action, amount);
    case "compoundV3Withdraw":
      return compoundV3Withdraw(l, action, amount);
    case "transfer":
      return transfer(l, action, amount);
    case "approve":
      return approve(l, action, amount);
    case "permit2Approve":
      return permit2Approve(l, action, amount);
    case "balanceOf":
      return balanceOf(l, action);
    case "nativeBalance":
      return l.result(l.nativeBalance());
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
    amountOutMinimum: word(action.amountOutMin),
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
 * mainnet Universal Router (`v4.mainnet.test.ts`), where the flattened encoding this replaced reverts.
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
  l.erc20Write("transfer", addr(currencyIn), addr(router), amountIn);
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
    () => l.selfBalance(addr(currencyOut)),
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
    () => l.selfBalance(addr(currencyOut)),
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
    l.erc20Write("transfer", tokenOut, recipient(action.recipient), delta);
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
    () => l.selfBalance(addr(assetOut)),
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
    () => l.selfBalance(addr(action.path[action.path.length - 1]!)),
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
    () => l.selfBalance(tokenOut),
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
          word(action.amountOutMin),
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
    list(action.pairs.map(addr)),
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
    () => l.selfBalance(addr(action.path[action.path.length - 1]!)),
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

// ---------------------------------------------------------------------------
// Bridges — the amount passes through
// ---------------------------------------------------------------------------

function acrossBridge(l: Lowering, action: AcrossBridgeAction, amount: Expr): ActionResult {
  // The Pot deposits, so an expired deposit is refunded to it. The relayer keeps the difference
  // between the input and output amounts; a fee above the amount reverts the subtraction.
  const message = l.bytes("msg", hexToBytes(action.message));
  const fee = BigInt(action.relayerFee);
  const outputAmount = fee === 0n ? amount : l.bind("out", `${amount} - ${word(fee)}`);
  l.exec("IAcrossSpokePool", addr(action.spokePool), "depositV3", [
    SELF, // depositor
    addr(action.recipient),
    addr(action.token), // inputToken
    addr(action.token), // outputToken: the same token on the destination
    amount,
    outputAmount,
    word(action.destChainId),
    ZERO, // exclusiveRelayer: none
    word(action.quoteTimestamp),
    word(action.fillDeadline),
    word(action.exclusivityDeadline),
    message,
  ]);

  return l.result(amount);
}

function stargateBridge(l: Lowering, action: StargateBridgeAction, amount: Expr): ActionResult {
  // Taxi mode (an empty `oftCmd`): the pool quotes the LayerZero fee for exactly this send, and the
  // send pays it from the Pot, which also receives any refund.
  const empty = l.bytes("empty", new Uint8Array());
  const sendParam = record({
    dstEid: word(action.dstEid),
    to: remote(action.recipient),
    amountLD: amount,
    minAmountLD: word(action.amountOutMin),
    extraOptions: empty,
    composeMsg: empty,
    oftCmd: empty,
  });
  const pool = addr(action.pool);
  const quoted = l.bind("lz", l.call("IStargatePool", pool, "quoteSend", [sendParam, "false"]));
  const nativeFee = l.bind("lzfee", `${quoted}.nativeFee`);
  l.valueCall("IStargatePool", pool, nativeFee, "send", [
    sendParam,
    record({ nativeFee, lzTokenFee: ZERO }),
    SELF,
  ]);

  return l.result(amount);
}

function cctpBridge(l: Lowering, action: CCTPBridgeAction, amount: Expr): ActionResult {
  l.exec("ICctpTokenMessenger", addr(action.tokenMessenger), "depositForBurn", [
    amount,
    word(action.destinationDomain),
    remote(action.recipient),
    addr(action.token),
    ZERO, // destinationCaller: anyone may relay the mint
    word(action.maxFee ?? "0"),
    word(action.minFinalityThreshold ?? CCTP_FINALIZED),
  ]);

  return l.result(amount);
}

function hyperlaneBridge(l: Lowering, action: HyperlaneBridgeAction, amount: Expr): ActionResult {
  const router = addr(action.router);
  const domain = word(action.destinationDomain);
  const gas = l.bind("igp", l.call("IWarpRoute", router, "quoteGasPayment", [domain]));
  l.valueCall("IWarpRoute", router, gas, "transferRemote", [
    domain,
    remote(action.recipient),
    amount,
  ]);

  return l.result(amount);
}

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

function wrapETH(l: Lowering, action: WrapETHAction, amount: Expr): ActionResult {
  l.valueCall("IWeth9", addr(action.weth), amount, "deposit", []);

  return l.result(amount);
}

function unwrapETH(l: Lowering, action: UnwrapETHAction, amount: Expr): ActionResult {
  l.exec("IWeth9", addr(action.weth), "withdraw", [amount]);

  return l.result(amount);
}

function wrapStETH(
  l: Lowering,
  action: WrapStETHAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  // `wrap` returns the wstETH it minted.
  const call = l.call("IWstEth", addr(action.wstETH), "wrap", [amount]);

  return captured(l, needsOutput, call, amount);
}

function unwrapStETH(
  l: Lowering,
  action: UnwrapStETHAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  // `unwrap` returns the stETH it released — never more than the Pot's balance grew by, so a later
  // action can always spend it.
  const call = l.call("IWstEth", addr(action.wstETH), "unwrap", [amount]);

  return captured(l, needsOutput, call, amount);
}

// ---------------------------------------------------------------------------
// Staking
// ---------------------------------------------------------------------------

function lidoStake(
  l: Lowering,
  action: LidoStakeAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  // `submit` returns shares, not stETH, and a stETH balance can round a wei below the ETH staked;
  // the output is the stETH balance delta.
  const stETH = addr(action.stETH);

  return balanceDelta(
    l,
    needsOutput,
    () => l.selfBalance(stETH),
    () =>
      l.valueCall("ILido", stETH, amount, "submit", [
        addr(action.referral ?? "0x0000000000000000000000000000000000000000"),
      ]),
    amount,
  );
}

function lidoUnstake(l: Lowering, action: LidoUnstakeAction, amount: Expr): ActionResult {
  l.exec("ILidoWithdrawalQueue", addr(action.withdrawalQueue), "requestWithdrawals", [
    list([amount]),
    recipient(action.owner),
  ]);

  return l.result(amount);
}

function rocketPoolStake(
  l: Lowering,
  action: RocketPoolStakeAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  return balanceDelta(
    l,
    needsOutput,
    () => l.selfBalance(addr(action.rETH)),
    () => l.valueCall("IRocketDepositPool", addr(action.depositPool), amount, "deposit", []),
    amount,
  );
}

function rocketPoolUnstake(
  l: Lowering,
  action: RocketPoolUnstakeAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  return balanceDelta(
    l,
    needsOutput,
    () => l.nativeBalance(),
    () => l.exec("IRocketTokenReth", addr(action.rETH), "burn", [amount]),
    amount,
  );
}

function etherFiStake(
  l: Lowering,
  action: EtherFiStakeAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  // `deposit` returns eETH shares; the output is the eETH balance delta.
  return balanceDelta(
    l,
    needsOutput,
    () => l.selfBalance(addr(action.eETH)),
    () => l.valueCall("IEtherFiLiquidityPool", addr(action.liquidityPool), amount, "deposit", []),
    amount,
  );
}

// ---------------------------------------------------------------------------
// Lending
// ---------------------------------------------------------------------------

function aaveV3Supply(l: Lowering, action: AaveV3SupplyAction, amount: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "supply", [
    addr(action.token),
    amount,
    recipient(action.onBehalfOf),
    word(action.referralCode ?? 0),
  ]);

  return l.result(amount);
}

function aaveV3Withdraw(
  l: Lowering,
  action: AaveV3WithdrawAction,
  amount: Expr,
  needsOutput: boolean,
): ActionResult {
  // `withdraw` returns the amount withdrawn, which is less than a `type(uint256).max` request.
  const call = l.call("IAaveV3Pool", addr(action.pool), "withdraw", [
    addr(action.token),
    amount,
    recipient(action.recipient),
  ]);

  return captured(l, needsOutput, call, amount);
}

function aaveV3Borrow(l: Lowering, action: AaveV3BorrowAction, amount: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "borrow", [
    addr(action.token),
    amount,
    word(AAVE_VARIABLE_RATE),
    word(action.referralCode ?? 0),
    recipient(action.onBehalfOf),
  ]);

  return l.result(amount);
}

function aaveV3Repay(l: Lowering, action: AaveV3RepayAction, amount: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "repay", [
    addr(action.token),
    amount,
    word(AAVE_VARIABLE_RATE),
    recipient(action.onBehalfOf),
  ]);

  return l.result(amount);
}

function compoundV3Supply(l: Lowering, action: CompoundV3SupplyAction, amount: Expr): ActionResult {
  l.exec("ICometMarket", addr(action.comet), "supply", [addr(action.token), amount]);

  return l.result(amount);
}

function compoundV3Withdraw(
  l: Lowering,
  action: CompoundV3WithdrawAction,
  amount: Expr,
): ActionResult {
  l.exec("ICometMarket", addr(action.comet), "withdraw", [addr(action.token), amount]);

  return l.result(amount);
}

// ---------------------------------------------------------------------------
// Tokens — the amount passes through, and nothing is decoded (`Lowering.erc20Write`)
// ---------------------------------------------------------------------------

function transfer(l: Lowering, action: TransferAction, amount: Expr): ActionResult {
  l.erc20Write("transfer", addr(action.token), recipient(action.recipient), amount);

  return l.result(amount);
}

function approve(l: Lowering, action: ApproveAction, amount: Expr): ActionResult {
  l.erc20Write("approve", addr(action.token), addr(action.spender), amount);

  return l.result(amount);
}

function permit2Approve(l: Lowering, action: Permit2ApproveAction, amount: Expr): ActionResult {
  l.exec("IPermit2", addr(action.permit2), "approve", [
    addr(action.token),
    addr(action.spender),
    amount,
    word(action.expiration),
  ]);

  return l.result(amount);
}

// ---------------------------------------------------------------------------
// Sources — produce a value
// ---------------------------------------------------------------------------

function balanceOf(l: Lowering, action: BalanceOfAction): ActionResult {
  return l.result(l.selfBalance(addr(action.token)));
}

function argument(l: Lowering, action: ArgumentAction): ActionResult {
  return l.result(argumentVar(action.name));
}
