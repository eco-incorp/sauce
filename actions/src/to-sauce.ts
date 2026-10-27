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
 * ONE SWAP IMPLEMENTATION. A swap action at one of `@sauce/router`'s venues is a call into
 * that library — `uniswapV2Swap` is `uniswapV2(...)`, `curveSwap` is `curve(...)` — with the
 * action's fields as its arguments, so an action program and a hand-written Sauce program trade a
 * venue through the same code. The program imports what it calls from `@sauce/router`, which the
 * SDK serves from memory (`compile.ts`). Only the venues the library does not cover lower here.
 *
 * AMOUNTS AND OUTPUTS. An action's amount is its `amount`, the local an earlier action saved under
 * its `amountRef`, or the previous action's output. Its output is what it delivered to the Pot
 * (`pot`) for a swap, a wrap or a stake and for an Aave withdrawal — the venue's return value
 * where that is the amount, a balance delta around the call where it is not — the value read for a
 * source action, and otherwise its own amount, passed through. An action whose output a later
 * action spends delivers to the Pot whatever its `recipient` says.
 *
 * THE POT. The generated program names the Pot the way the emitter says (`emit.ts#PotNames`):
 * `pot` and `pot.balance` for a chain, the compiler's builtins for a split swap with none.
 */
import {
  bindBytes,
  bindConst,
  encodeArgs,
  fn,
  hexToBytes,
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
import { CONTRACT_NAME_RE, isName, NATIVE } from "./names.js";
import { safeApproveStatements, safeTransferStatements, type WordArg } from "./registry.js";
import { consumesPrevious } from "./semantics.js";
import { ACTION_SPECS, POT } from "./spec.js";

import type {
  Action,
  Recipient,
  RemoteRecipient,
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

/** type(int256).max — Balancer's "no limit" for an asset the Vault may take. */
const MAX_INT256 = (1n << 255n) - 1n;

/** Aave V3's variable interest-rate mode, the only one it offers. */
const AAVE_VARIABLE_RATE = 2n;

/** CCTP V2's `minFinalityThreshold` for a standard (finalized) transfer. */
const CCTP_FINALIZED = 2000;

const ZERO = "0";

/** An integer field, as the decimal literal the emitted source carries. */
function word(value: string | number | bigint): Expr {
  return BigInt(value).toString();
}

/**
 * A token or contract field as the program reads it: a name is the program global of that name
 * (`USDC`, `UniswapV3.Factory`), which the compile resolves on its chain; `"native"` is the zero
 * address the venue keys the native currency as; an address is a hex literal, so the emitted source
 * reads like the addresses it was built from. A name is emitted as written: `program.ts` admits
 * only an identifier or `Identifier.Identifier`.
 */
function addr(value: string | bigint): Expr {
  if (typeof value === "string" && isName(value)) return value;
  if (value === NATIVE) return "0";

  return `0x${BigInt(value).toString(16).padStart(40, "0")}`;
}

/** A recipient field: an address, or the Pot for `"pot"`. */
function recipient(l: Lowering, value: Recipient): Expr {
  return value === POT ? l.pot : addr(value);
}

/** A bytes32 field (a pool id). */
function b32(value: string): Expr {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
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
  /** The `@sauce/router` functions `stmts` call. */
  readonly router: readonly RouterFunction[];
}

/** A function of `@sauce/router`, the one implementation of a swap at its venue. */
export type RouterFunction =
  | "uniswapV2"
  | "uniswapV3"
  | "uniswapV4"
  | "curve"
  | "balancerV2"
  | "dodoV2"
  | "traderJoeLB"
  | "woofi"
  | "maverickV2";

/** Collects one action's statements and the bindings they name. */
class Lowering {
  readonly stmts: Stmt[] = [];
  private readonly used = new Set<BindingName>();
  private readonly library = new Set<RouterFunction>();

  /** `where` names the action in a revert message: `actions[2]`. */
  constructor(
    readonly emit: Emitter,
    readonly where: string,
  ) {}

  /** The Pot's address, as the program names it. */
  get pot(): Expr {
    return this.emit.pot.address;
  }

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
        ? safeApproveStatements(prefix, token, this.wordArg(first), this.wordArg(amount), this.pot)
        : safeTransferStatements(prefix, token, this.wordArg(first), this.wordArg(amount));
    this.stmts.push(...statements);
  }

  /** A word `token/safe` can splice: a literal, or a local (an expression is bound to one). */
  private wordArg(expr: Expr): WordArg {
    const literal = /^(0x[0-9a-f]+|[0-9]+)$/.exec(expr);
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
    this.stmts.push(`${this.valueCallExpr(binding, target, value, method, args)};`);
  }

  /** `valueCall` as an expression — not yet a statement — whose value is the call's return data. */
  valueCallExpr<B extends BindingName>(
    binding: B,
    target: Expr,
    value: Expr,
    method: MethodName<B>,
    args: Expr[],
  ): Expr {
    const sel = this.bytes("sel", hexToBytes(methodSelector(binding, method)));
    const data = args.length === 0 ? sel : `${sel}.concat(${encodeArgs(args)})`;

    return `evm.call(${target}, ${value}, ${data})`;
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
  potBalance(token: Expr): Expr {
    return this.bind("bal", this.call("IErc20", token, "balanceOf", [this.pot]));
  }

  /**
   * The Pot's balance of an asset a venue may pay in the native currency — `"native"` or the zero
   * address, which Ambient and the Balancer V2 Vault key it as: its native balance, not an ERC-20
   * read of the zero address, which has no code to answer.
   */
  assetBalance(asset: string): Expr {
    const native = asset === NATIVE || (/^0x/i.test(asset) && BigInt(asset) === 0n);

    return native ? this.nativeBalance() : this.potBalance(addr(asset));
  }

  /** The Pot's native balance, as a bound local. */
  nativeBalance(): Expr {
    return this.bind("nat", this.emit.pot.balance);
  }

  /** `fn(args)`, a call into `@sauce/router` — the expression, not yet a statement. */
  router(fn: RouterFunction, args: readonly Expr[]): Expr {
    this.library.add(fn);

    return `${fn}(${args.join(", ")})`;
  }

  result(output: Expr): ActionResult {
    return { stmts: this.stmts, output, bindings: [...this.used], router: [...this.library] };
  }
}

/**
 * A pool given by its key, read from its factory while the program runs: by namespace when the
 * factory is named (`UniswapV3.Factory.getPool(...)`, the registry's own ABI for it), through
 * `binding` when it is an address. `field` picks the pool out of a struct the lookup returns. No
 * pool under that key on this chain reads as the zero address, which reverts the program before
 * anything moves.
 */
function keyedPool<B extends BindingName>(
  l: Lowering,
  factory: string,
  binding: B,
  method: MethodName<B>,
  args: Expr[],
  field?: string,
): Expr {
  const lookup = CONTRACT_NAME_RE.test(factory)
    ? `${factory}.${method}(${args.join(", ")})`
    : l.call(binding, addr(factory), method, args);
  let pool = l.bind("pool", lookup);
  if (field !== undefined) pool = l.bind("pool", `${pool}.${field}`);
  l.stmts.push(`require(${pool} != 0, "${l.where}: no pool under that key");`);

  return pool;
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

/** A program's parts, before `renderProgram` renders them for a standalone compile. */
export interface Lowered {
  readonly body: readonly Stmt[];
  readonly contracts: ActionContracts;
  /** The `@sauce/router` functions the body calls, which the program imports. */
  readonly router: readonly RouterFunction[];
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
  const router = new Set<RouterFunction>();
  const parameters: string[] = [];
  const declared = new Set<string>();
  let previous: string | undefined;

  actions.forEach((action, i) => {
    if (action.type === "argument") parameters.push(action.name);

    const next = actions[i + 1];
    const needsOutput =
      action.saveOutputAs !== undefined || (next !== undefined && consumesPrevious(next));

    const result = lowerAction(
      emit,
      action,
      amountOf(action, previous),
      needsOutput,
      `actions[${i}]`,
    );
    body.push(...result.stmts);
    for (const b of result.bindings) bindings.add(b);
    for (const f of result.router) router.add(f);

    if (needsOutput) {
      const slot = action.saveOutputAs === undefined ? `t_out${i}` : slotVar(action.saveOutputAs);
      body.push(
        declared.has(slot) ? `${slot} = ${result.output};` : `let ${slot} = ${result.output};`,
      );
      declared.add(slot);
      previous = slot;
    }
  });

  return { body, contracts: contractsFor(bindings), router: [...router].sort(), parameters };
}

/** The line importing what the program calls from `@sauce/router`, or nothing. */
export function routerImport(router: readonly RouterFunction[]): string {
  return router.length === 0 ? "" : `import { ${router.join(", ")} } from "@sauce/router";\n\n`;
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

  return `${routerImport(lowered.router)}${fn("main", params, "void", lowered.body)}\n`;
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
  where = "action",
): ActionResult {
  const l = new Lowering(emit, where);
  switch (action.type) {
    case "uniswapV2Swap":
      return uniswapV2Swap(l, action, amount, needsOutput);
    case "uniswapV3Swap":
      return uniswapV3Swap(l, action, amount, needsOutput);
    case "uniswapV4Swap":
      return uniswapV4Swap(l, action, amount, needsOutput);
    case "curveSwap":
      return curveSwap(l, action, amount, needsOutput);
    case "balancerV2Swap":
      return balancerV2Swap(l, action, amount, needsOutput);
    case "dodoV2Swap":
      return dodoV2Swap(l, action, amount, needsOutput);
    case "traderJoeLBSwap":
      return traderJoeLBSwap(l, action, amount, needsOutput);
    case "woofiSwap":
      return woofiSwap(l, action, amount, needsOutput);
    case "maverickV2Swap":
      return maverickV2Swap(l, action, amount, needsOutput);
    case "curveRouterNGSwap":
      return curveRouterNGSwap(l, action, amount, needsOutput);
    case "balancerV2BatchSwap":
      return balancerV2BatchSwap(l, action, amount, needsOutput);
    case "balancerV3Swap":
      return balancerV3Swap(l, action, amount, needsOutput);
    case "ambientSwap":
      return ambientSwap(l, action, amount, needsOutput);
    case "dodoV1Swap":
      return dodoV1Swap(l, action, amount, needsOutput);
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
// Swap actions — through `@sauce/router`
// ---------------------------------------------------------------------------

/**
 * Where a realized output goes (a swap's, an Aave withdrawal's): the Pot when a later action spends
 * it, else its recipient.
 * Every `@sauce/router` function returns what the recipient received, which is the action's output.
 */
function swapRecipient(l: Lowering, action: { recipient: Recipient }, needsOutput: boolean): Expr {
  return needsOutput ? l.pot : recipient(l, action.recipient);
}

function uniswapV2Swap(
  l: Lowering,
  action: UniswapV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const pair =
    action.pool !== undefined
      ? addr(action.pool)
      : keyedPool(l, action.factory, "IUniswapV2Factory", "getPair", [
          addr(action.tokenIn),
          addr(action.tokenOut),
        ]);
  const call = l.router("uniswapV2", [
    pair,
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.feePpm ?? 0),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function uniswapV3Swap(
  l: Lowering,
  action: UniswapV3SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const tokens = [addr(action.tokenIn), addr(action.tokenOut)];
  const pool =
    action.pool !== undefined
      ? addr(action.pool)
      : action.fee !== undefined
        ? keyedPool(l, action.factory, "IUniswapV3Factory", "getPool", [
            ...tokens,
            word(action.fee),
          ])
        : keyedPool(l, action.factory, "ISlipstreamFactory", "getPool", [
            ...tokens,
            word(action.tickSpacing),
          ]);
  const call = l.router("uniswapV3", [
    pool,
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.sqrtPriceLimitX96 ?? "0"),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function uniswapV4Swap(
  l: Lowering,
  action: UniswapV4SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("uniswapV4", [
    addr(action.poolManager),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.fee),
    word(action.tickSpacing),
    action.hooks === undefined ? ZERO : addr(action.hooks),
    word(action.sqrtPriceLimitX96 ?? "0"),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function curveSwap(
  l: Lowering,
  action: CurveSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("curve", [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.i),
    word(action.j),
    flag(action.indexType === "uint256"),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function balancerV2Swap(
  l: Lowering,
  action: BalancerV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("balancerV2", [
    addr(action.vault),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    b32(action.poolId),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function dodoV2Swap(
  l: Lowering,
  action: DodoV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("dodoV2", [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    addr(action.baseToken),
    addr(action.quoteToken),
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function traderJoeLBSwap(
  l: Lowering,
  action: TraderJoeLBSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const pair =
    action.pool !== undefined
      ? addr(action.pool)
      : keyedPool(
          l,
          action.factory,
          "ILBFactory",
          "getLBPairInformation",
          [addr(action.tokenIn), addr(action.tokenOut), word(action.binStep)],
          "LBPair",
        );
  // The pair's own tokens, read from it when the action leaves them out.
  const [tokenX, tokenY] =
    action.tokenX !== undefined
      ? [addr(action.tokenX), addr(action.tokenY)]
      : [
          l.bind("tokenX", l.call("ILBPair", pair, "getTokenX", [])),
          l.bind("tokenY", l.call("ILBPair", pair, "getTokenY", [])),
        ];
  const call = l.router("traderJoeLB", [
    pair,
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    tokenX,
    tokenY,
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function woofiSwap(
  l: Lowering,
  action: WoofiSwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("woofi", [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

function maverickV2Swap(
  l: Lowering,
  action: MaverickV2SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  const call = l.router("maverickV2", [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amountIn);
}

// ---------------------------------------------------------------------------
// Swap actions — venues `@sauce/router` does not cover
// ---------------------------------------------------------------------------

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
  const outputIndex = action.steps[action.steps.length - 1]!.assetOutIndex;
  // Limits apply to net asset deltas: the Vault must pay at least `amountOutMin` of the last
  // step's output asset, wherever it appears in `assets`. Other assets have no output floor.
  const limits = list(
    action.assets.map((_, i) =>
      i === outputIndex ? `Int256(-${word(action.amountOutMin)})` : `Int256(${word(MAX_INT256)})`,
    ),
  );
  const funds = record({
    sender: l.pot,
    fromInternalBalance: flag(false),
    recipient: swapRecipient(l, action, needsOutput),
    toInternalBalance: flag(false),
  });

  // `batchSwap` returns `int256[] assetDeltas`, signed and negative for what was received; the
  // realized output is the executing account's delta on the last step's output asset instead.
  const assetOut = action.assets[outputIndex]!;

  return balanceDelta(
    l,
    needsOutput,
    () => l.assetBalance(assetOut),
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
    swapRecipient(l, action, needsOutput),
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
  const router = addr(action.router);
  const args = [
    addr(action.pool),
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    word(action.deadline),
    flag(action.wethIsEth),
    userData,
  ];
  if (!action.wethIsEth) {
    const call = l.call("IBalancerV3Router", router, "swapSingleTokenExactIn", args);

    return captured(l, needsOutput, call, amountIn);
  }

  // With `wethIsEth` the Router takes an input that is its own WETH (`getWeth()`) as native ETH:
  // it wraps exactly the input out of the value sent, reverts when the value is short and returns
  // any excess. Any other input it pulls through Permit2. So the value is the input exactly when
  // the Router reads it as ETH — and the call is raw, because a binding cannot attach value.
  const weth = l.bind("weth", l.call("IBalancerV3Router", router, "getWeth", []));
  const value = l.bind("val", `${addr(action.tokenIn)} == ${weth} ? ${amountIn} : 0`);
  const call = l.valueCallExpr("IBalancerV3Router", router, value, "swapSingleTokenExactIn", args);
  if (!needsOutput) {
    l.stmts.push(`${call};`);

    return l.result(amountIn);
  }
  // The return data is the `amountOut` the Router paid the Pot: WETH's paid as ETH under the flag.
  const ret = l.bind("ret", call);
  const decoded = l.bind("dec", `abi.decode(${ret}, ["Uint256"])`);

  return l.result(l.bind("amt", `${decoded}[0]`));
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
  const received = action.isBuy ? action.quote : action.base;

  return balanceDelta(
    l,
    needsOutput,
    () => l.assetBalance(received),
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
      l.exec("ICrocSwapDex", addr(action.dex), "userCmd", ["1", cmd]);
    },
    amountIn,
  );
}

function dodoV1Swap(
  l: Lowering,
  action: DodoV1SwapAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  // The proxy pays msg.sender and returns the amount it paid. Allowances go to DODOApprove, not to
  // the proxy.
  const call = l.call("IDodoProxy", addr(action.proxy), "dodoSwapV1", [
    addr(action.tokenIn),
    addr(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    list(action.pairs.map(addr)),
    word(action.directions),
    flag(false), // isIncentive
    word(action.deadline),
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
    () => l.potBalance(addr(action.path[action.path.length - 1]!)),
    () =>
      l.exec("IUniswapV2Router", addr(action.router), "swapExactTokensForTokens", [
        amountIn,
        word(action.amountOutMin),
        list(action.path.map(addr)),
        swapRecipient(l, action, needsOutput),
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
    swapRecipient(l, action, needsOutput),
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
    l.pot, // depositor
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
    l.pot,
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
    () => l.potBalance(stETH),
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
    recipient(l, action.owner),
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
    () => l.potBalance(addr(action.rETH)),
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
    () => l.potBalance(addr(action.eETH)),
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
    recipient(l, action.onBehalfOf),
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
    swapRecipient(l, action, needsOutput),
  ]);

  return captured(l, needsOutput, call, amount);
}

function aaveV3Borrow(l: Lowering, action: AaveV3BorrowAction, amount: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "borrow", [
    addr(action.token),
    amount,
    word(AAVE_VARIABLE_RATE),
    word(action.referralCode ?? 0),
    recipient(l, action.onBehalfOf),
  ]);

  return l.result(amount);
}

function aaveV3Repay(l: Lowering, action: AaveV3RepayAction, amount: Expr): ActionResult {
  l.exec("IAaveV3Pool", addr(action.pool), "repay", [
    addr(action.token),
    amount,
    word(AAVE_VARIABLE_RATE),
    recipient(l, action.onBehalfOf),
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
  l.erc20Write("transfer", addr(action.token), recipient(l, action.recipient), amount);

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
  return l.result(l.potBalance(addr(action.token)));
}

function argument(l: Lowering, action: ArgumentAction): ActionResult {
  return l.result(argumentVar(action.name));
}
