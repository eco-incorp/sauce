/**
 * Routing actions -> a SauceScript program, compiled by the published Rust/wasm compiler.
 *
 * This used to compose builder nodes (`s.int`, `s.externalCall`, `chain.join`) against the in-repo
 * TypeScript compiler's `Saucer`. That compiler is retired and the Rust one's only surface is
 * `compile()` over source text, so every action now emits SauceScript STATEMENTS instead — the
 * idiom `sdk/src/deposit/templates.ts` and `sdk/src/token/svm.ts` already use.
 *
 * WHAT DID NOT CHANGE: the calldata. Every action still targets the same address with the same
 * selector and the same ABI-encoded arguments; `emit.ts`'s `encodeArgs` reproduces the retired
 * builder's `abiEncode(tuple(args))` for every arity. What changed is the shape of the intermediate
 * representation, and two things that were latent bugs in it:
 *
 *   - the per-build scratch-slot counters (`curveScratchCounter`, `v2ScratchCounter`) were
 *     module-level and leaked across builds; they are the [`Emitter`]'s now, so a program's names
 *     depend only on that program;
 *   - a call whose `uint256` return value is consumed binds it to a local. The builder returned an
 *     expression that re-issued the call on each use, which is one on-chain call per use.
 */
import {
  arrayLiteral,
  bindBytes,
  bindConst,
  calldata,
  concatCalldata,
  decodeUint256,
  encodeArgs,
  formatBigint,
  fn,
  hexToBytes,
  newEmitter,
  selector,
  slotVar,
  tupleLiteral as tuple,
  type Emitter,
  type Expr,
  type Fragment,
  type Stmt,
} from './emit.js';
import { compileEvm } from './compile.js';
import { encodeAbiParameters } from 'viem';

import type {
  RoutingAction,
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
} from './types.js';

/** V4 ActionConstants.CONTRACT_BALANCE — signals the router to use its own token balance. */
const V4_CONTRACT_BALANCE = BigInt('0x8000000000000000000000000000000000000000000000000000000000000000');

/** V4 ActionConstants.OPEN_DELTA — signals "take all owed" in a TAKE action. */
const V4_OPEN_DELTA = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

const ZERO = '0n';
const SELF = 'ctx.self()';
const MSG_SENDER = 'ctx.msgSender()';

/** An address, pool id or any other 256-bit field, as the literal the emitted source carries. */
function word(value: string | number | bigint): Expr {
  return formatBigint(BigInt(value));
}

function flag(value: boolean): Expr {
  return value ? '1n' : '0n';
}

function evmCall(target: Expr, value: Expr, data: Expr): Expr {
  return `evm.call(${target}, ${value}, ${data})`;
}

// ---------------------------------------------------------------------------
// Amount resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the amount for an action:
 * 1. Explicit amount string (highest priority)
 * 2. amountRef — the local a previous action saved its output to
 * 3. lastOutputSlot — implicit chain from the previous action
 */
function resolveAmountIn(
  explicitAmount: string | undefined,
  amountRef: string | undefined,
  lastOutputSlot: string | undefined,
): Expr {
  if (explicitAmount !== undefined) return word(explicitAmount);
  if (amountRef !== undefined) return slotVar(amountRef);
  if (lastOutputSlot !== undefined) return lastOutputSlot;
  throw new Error(
    'No amount specified: provide an explicit amount, amountRef, or chain from a previous action',
  );
}

/** Extract the explicit amount field from any action type. */
function getExplicitAmount(action: RoutingAction): string | undefined {
  const a = action as Record<string, any>;
  return a.amountIn ?? a.amount ?? a.stETHAmount ?? a.wstETHAmount ?? a.steps?.[0]?.amount;
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
   * return value was not requested leaves the pass-through input amount here — the same looseness
   * the retired builder had, and for the same reason: nothing reads it in that case.
   */
  readonly output: Expr;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** The SauceScript source for `actions`. Empty for an empty list. */
export function actionsToSauceSource(actions: readonly RoutingAction[]): string {
  if (actions.length === 0) return '';

  const emit = newEmitter();
  const body: Stmt[] = [];
  const declared = new Set<string>();
  let lastOutputSlot: string | undefined;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const amountIn = resolveAmountIn(getExplicitAmount(action), action.amountRef, lastOutputSlot);

    // Determine if we need to store the output
    const needsStore =
      action.saveOutputAs !== undefined ||
      actions.slice(i + 1).some(
        (a) => getExplicitAmount(a) === undefined && a.amountRef === undefined,
      ) ||
      actions.slice(i + 1).some((a) => a.amountRef === action.saveOutputAs);

    const result = buildAction(emit, action, amountIn, needsStore);
    body.push(...result.stmts);

    if (needsStore) {
      const slot = action.saveOutputAs === undefined ? `t_out${i}` : slotVar(action.saveOutputAs);
      body.push(declared.has(slot) ? `${slot} = ${result.output};` : `let ${slot} = ${result.output};`);
      declared.add(slot);
      lastOutputSlot = slot;
    }
  }

  return `${fn('main', [], 'void', body)}\n`;
}

export function actionsToSauce(actions: readonly RoutingAction[]): Uint8Array {
  const source = actionsToSauceSource(actions);

  return source === '' ? new Uint8Array() : compileEvm(source);
}

export function actionToSauce(action: RoutingAction): Uint8Array {
  return actionsToSauce([action]);
}

/**
 * Emit the statements for one action.
 *
 * BREAKING: this took a `Saucer` and a `Saucer` amount and returned builder nodes. It now takes an
 * [`Emitter`] (from `newEmitter()`) and a SauceScript amount EXPRESSION, and returns source
 * fragments. `needsOutput` is the old `outputChained` under its real name: it both selects the
 * recipient (`ctx.self()` when the output is consumed here, the action's own `recipient` otherwise)
 * and decides whether a call's `uint256` return value is captured.
 */
export function buildAction(
  emit: Emitter,
  action: RoutingAction,
  amountIn: Expr,
  needsOutput: boolean,
): ActionResult {
  switch (action.type) {
    case 'uniswapV3ExactInput':        return uniswapV3ExactInput(emit, action, amountIn, needsOutput);
    case 'uniswapV3ExactInputMultiHop': return uniswapV3ExactInputMultiHop(emit, action, amountIn, needsOutput);
    case 'uniswapV4ExactInput':        return uniswapV4ExactInput(emit, action, amountIn);
    case 'uniswapV4ExactInputMultiHop': return uniswapV4ExactInputMultiHop(emit, action, amountIn);
    case 'curveSwap':                  return curveSwap(emit, action, amountIn, needsOutput);
    case 'balancerV2Swap':             return balancerV2Swap(emit, action, amountIn, needsOutput);
    case 'balancerV2BatchSwap':        return balancerV2BatchSwap(emit, action, amountIn, needsOutput);
    case 'balancerV3Swap':             return balancerV3Swap(emit, action, amountIn, needsOutput);
    case 'uniswapV2Swap':              return uniswapV2Swap(emit, action, amountIn, needsOutput);
    case 'curveRouterNGSwap':          return curveRouterNGSwap(emit, action, amountIn, needsOutput);
    case 'ambientSwap':                return ambientSwap(emit, action, amountIn);
    case 'dodoSwap':                   return dodoSwap(emit, action, amountIn, needsOutput);
    case 'maverickSwap':               return maverickSwap(emit, action, amountIn, needsOutput);
    case 'maverickMultiHopSwap':       return maverickMultiHopSwap(emit, action, amountIn, needsOutput);
    case 'carbonSwap':                 return carbonSwap(emit, action, amountIn, needsOutput);
    case 'fraxswapSwap':               return fraxswapSwap(emit, action, amountIn, needsOutput);
    case 'clipperSwap':                return clipperSwap(emit, action, amountIn, needsOutput);
    case 'integralSwap':               return integralSwap(emit, action, amountIn, needsOutput);
    case 'fluidDexT1Swap':             return fluidDexT1Swap(emit, action, amountIn, needsOutput);
    case 'fluidDexLiteSwap':           return fluidDexLiteSwap(emit, action, amountIn);
    case 'transfer':                   return transfer(emit, action, amountIn);
    case 'approve':                    return approve(emit, action, amountIn);
    case 'wrapETH':                    return wrapETH(emit, action, amountIn);
    case 'unwrapETH':                  return unwrapETH(emit, action, amountIn);
    case 'wrapStETH':                  return wrapStETH(emit, action, amountIn);
    case 'unwrapStETH':                return unwrapStETH(emit, action, amountIn);
    case 'lidoStake':                  return lidoStake(emit, action, amountIn);
    case 'lidoUnstake':                return lidoUnstake(emit, action, amountIn);
    case 'rocketPoolStake':            return rocketPoolStake(emit, action, amountIn);
    case 'rocketPoolUnstake':          return rocketPoolUnstake(emit, action, amountIn);
    case 'coinbaseStake':              return coinbaseStake(emit, action, amountIn);
    case 'etherFiStake':               return etherFiStake(emit, action, amountIn);
    case 'aaveV3Supply':               return aaveV3Supply(emit, action, amountIn);
    case 'aaveV3Withdraw':             return aaveV3Withdraw(emit, action, amountIn, needsOutput);
    case 'aaveV3Borrow':               return aaveV3Borrow(emit, action, amountIn);
    case 'aaveV3Repay':                return aaveV3Repay(emit, action, amountIn);
    case 'compoundV3Supply':           return compoundV3Supply(emit, action, amountIn);
    case 'compoundV3Withdraw':         return compoundV3Withdraw(emit, action, amountIn);
    case 'acrossBridge':               return acrossBridge(emit, action, amountIn);
    case 'stargateBridge':             return stargateBridge(emit, action, amountIn);
    case 'cctpBridge':                 return cctpBridge(emit, action, amountIn);
    case 'hyperlaneBridge':            return hyperlaneBridge(emit, action, amountIn);
    default: {
      const _: never = action;
      throw new Error(`Unknown action type: ${(_ as any).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Call shapes
// ---------------------------------------------------------------------------

/** A call whose `uint256` return value is the action's output when `needsOutput`. */
function capturedCall(
  emit: Emitter,
  needsOutput: boolean,
  target: Expr,
  value: Expr,
  cd: Fragment,
  passThrough: Expr,
): ActionResult {
  const call = evmCall(target, value, cd.expr);
  if (!needsOutput) return { stmts: [...cd.stmts, `${call};`], output: passThrough };

  const decoded = decodeUint256(emit, call);
  const bound = bindConst(emit, 'amt', decoded.expr);

  return { stmts: [...cd.stmts, ...decoded.stmts, ...bound.stmts], output: bound.expr };
}

/** A call with no usable return value — the input amount passes through. */
function voidCall(target: Expr, value: Expr, cd: Fragment, passThrough: Expr): ActionResult {
  return { stmts: [...cd.stmts, `${evmCall(target, value, cd.expr)};`], output: passThrough };
}

/** `balanceOf(ctx.self())` on `token`, as a bound `uint256` local. */
function selfBalance(emit: Emitter, token: Expr): Fragment {
  const cd = calldata(emit, 'balanceOf(address)', [SELF]);
  const decoded = decodeUint256(emit, evmCall(token, ZERO, cd.expr));
  const bound = bindConst(emit, 'bal', decoded.expr);

  return { stmts: [...cd.stmts, ...decoded.stmts, ...bound.stmts], expr: bound.expr };
}

// ---------------------------------------------------------------------------
// Swap actions — capture uint256 output
// ---------------------------------------------------------------------------

function uniswapV3ExactInput(emit: Emitter, action: UniswapV3ExactInputAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const params = [
    word(action.tokenIn),
    word(action.tokenOut),
    word(action.fee),
    recipient,
    amountIn,
    word(action.amountOutMin ?? '0'),
    word(action.sqrtPriceLimitX96 ?? '0'),
  ];
  const cd = calldata(
    emit,
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    [tuple(params)],
  );

  return capturedCall(emit, needsOutput, word(action.router), ZERO, cd, amountIn);
}

function uniswapV3ExactInputMultiHop(emit: Emitter, action: UniswapV3ExactInputMultiHopAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const path = bindBytes(emit, 'path', hexToBytes(action.path));
  const cd = calldata(
    emit,
    'exactInput((bytes,address,uint256,uint256))',
    [tuple([path.expr, recipient, amountIn, word(action.amountOutMin)])],
  );

  return capturedCall(
    emit,
    needsOutput,
    word(action.router),
    ZERO,
    { stmts: [...path.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function uniswapV4ExactInput(emit: Emitter, action: UniswapV4ExactInputAction, amountIn: Expr): ActionResult {
  const currencyIn = action.zeroForOne ? action.poolKey.currency0 : action.poolKey.currency1;
  const currencyOut = action.zeroForOne ? action.poolKey.currency1 : action.poolKey.currency0;

  // Transfer input token to the router so it can settle without Permit2
  const transferCd = calldata(emit, 'transfer(address,uint256)', [word(action.router), amountIn]);

  // ExactInputSingleParams: { PoolKey poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData }
  const poolKeyAbi = { type: 'tuple', components: [
    { type: 'address', name: 'currency0' },
    { type: 'address', name: 'currency1' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickSpacing' },
    { type: 'address', name: 'hooks' },
  ]} as const;
  const swapParams = encodeAbiParameters(
    [poolKeyAbi, { type: 'bool' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
    [
      { currency0: action.poolKey.currency0, currency1: action.poolKey.currency1, fee: action.poolKey.fee, tickSpacing: action.poolKey.tickSpacing, hooks: action.poolKey.hooks },
      action.zeroForOne,
      BigInt(action.amountIn ?? '0'),
      BigInt(action.amountOutMin),
      '0x',
    ],
  );

  // SETTLE (0x0b) with payerIsUser=false + CONTRACT_BALANCE (0) — router uses its own balance
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [currencyIn, V4_CONTRACT_BALANCE, false],
  );

  // TAKE (0x0e) — sends output to specified recipient, OPEN_DELTA = take all owed
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [currencyOut, action.recipient, V4_OPEN_DELTA],
  );

  const executeCalldata = v4ExecuteCalldata('0x060b0e', [swapParams, settleParams, takeParams]);

  const sel = bindBytes(emit, 'sel', selector('execute(bytes,bytes[])'));
  const blob = bindBytes(emit, 'v4', hexToBytes(executeCalldata));

  return {
    stmts: [
      ...transferCd.stmts,
      `${evmCall(word(currencyIn), ZERO, transferCd.expr)};`,
      ...sel.stmts,
      ...blob.stmts,
      `${evmCall(word(action.router), ZERO, concatCalldata(sel.expr, [blob.expr]))};`,
    ],
    output: amountIn,
  };
}

function uniswapV4ExactInputMultiHop(emit: Emitter, action: UniswapV4ExactInputMultiHopAction, amountIn: Expr): ActionResult {
  const currencyOut = action.path[action.path.length - 1].intermediateCurrency;

  const transferCd = calldata(emit, 'transfer(address,uint256)', [word(action.router), amountIn]);

  // ExactInputParams: { Currency currencyIn, PathKey[] path, uint256[] maxHopSlippage, uint128 amountIn, uint128 amountOutMinimum }
  const pathKeyAbi = { type: 'tuple[]', components: [
    { type: 'address', name: 'intermediateCurrency' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickSpacing' },
    { type: 'address', name: 'hooks' },
    { type: 'bytes', name: 'hookData' },
  ]} as const;
  const swapParams = encodeAbiParameters(
    [{ type: 'address' }, pathKeyAbi, { type: 'uint256[]' }, { type: 'uint128' }, { type: 'uint128' }],
    [
      action.currencyIn,
      action.path.map((step) => ({ intermediateCurrency: step.intermediateCurrency, fee: step.fee, tickSpacing: step.tickSpacing, hooks: step.hooks, hookData: '0x' as `0x${string}` })),
      [], // maxHopSlippage — empty array means no per-hop slippage limits
      BigInt(action.amountIn ?? '0'),
      BigInt(action.amountOutMin),
    ],
  );

  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [action.currencyIn, V4_CONTRACT_BALANCE, false],
  );

  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [currencyOut, action.recipient, V4_OPEN_DELTA],
  );

  const executeCalldata = v4ExecuteCalldata('0x070b0e', [swapParams, settleParams, takeParams]);

  const sel = bindBytes(emit, 'sel', selector('execute(bytes,bytes[])'));
  const blob = bindBytes(emit, 'v4', hexToBytes(executeCalldata));

  return {
    stmts: [
      ...transferCd.stmts,
      `${evmCall(word(action.currencyIn), ZERO, transferCd.expr)};`,
      ...sel.stmts,
      ...blob.stmts,
      `${evmCall(word(action.router), ZERO, concatCalldata(sel.expr, [blob.expr]))};`,
    ],
    output: amountIn,
  };
}

/** `abi.encode(bytes("0x10"), [abi.encode(actions, params)])` — the V4 router's two-level input. */
function v4ExecuteCalldata(actions: `0x${string}`, params: readonly `0x${string}`[]): `0x${string}` {
  const v4Input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params as never]);

  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], ['0x10', [v4Input]]);
}

function curveSwap(emit: Emitter, action: CurveSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  // Older Curve pools (e.g. 3pool at 0xbEbc44...) expose only the 4-arg `exchange` which returns
  // VOID and sends the output to msg.sender. We snapshot the pre-swap `tokenOut` balance, call the
  // 4-arg exchange (Sauce is msg.sender — output lands here), then compute `post - pre` to recover
  // this swap's output without sweeping any pre-existing dust from earlier actions.
  const tokenOut = word(action.tokenOut);
  const pre = selfBalance(emit, tokenOut);
  const exchangeCd = calldata(emit, 'exchange(int128,int128,uint256,uint256)', [
    word(action.i),
    word(action.j),
    amountIn,
    word(action.amountOutMin),
  ]);
  const post = selfBalance(emit, tokenOut);
  const delta = bindConst(emit, 'delta', `${post.expr} - ${pre.expr}`);

  const captureAndSwap: Stmt[] = [
    ...pre.stmts,
    ...exchangeCd.stmts,
    `${evmCall(word(action.pool), ZERO, exchangeCd.expr)};`,
    ...post.stmts,
    ...delta.stmts,
  ];

  if (needsOutput) return { stmts: captureAndSwap, output: delta.expr };

  // Non-chained: forward the delta to the recipient.
  const transferCd = calldata(emit, 'transfer(address,uint256)', [word(action.recipient), delta.expr]);

  return {
    stmts: [
      ...captureAndSwap,
      ...transferCd.stmts,
      `${evmCall(tokenOut, ZERO, transferCd.expr)};`,
    ],
    output: delta.expr,
  };
}

function balancerV2Swap(emit: Emitter, action: BalancerV2SwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const userData = bindBytes(emit, 'ud', new Uint8Array(0));
  const singleSwap = tuple([
    word(action.poolId), // bytes32 — must be static, not dynamic bytes
    ZERO,                // kind = GIVEN_IN
    word(action.tokenIn),
    word(action.tokenOut),
    amountIn,
    userData.expr,
  ]);
  const funds = tuple([
    SELF,      // sender — must equal msg.sender (Sauce) for vault auth
    ZERO,
    recipient, // recipient — Sauce when chaining, caller otherwise
    ZERO,
  ]);
  const cd = calldata(
    emit,
    'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)',
    [singleSwap, funds, word(action.amountOutMin), word(action.deadline)],
  );

  return capturedCall(
    emit,
    needsOutput,
    word(action.vault),
    ZERO,
    { stmts: [...userData.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function balancerV2BatchSwap(emit: Emitter, action: BalancerV2BatchSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipientExpr = needsOutput ? SELF : word(action.recipient);
  // Pre-encode the complex calldata with viem, then splice in the runtime values for funds.sender
  // (ctx.self()) and funds.recipient.
  const MAX_INT256 = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819967');

  const stepsData = action.steps.map((step) => ({
    poolId: step.poolId as `0x${string}`,
    assetInIndex: BigInt(step.assetInIndex),
    assetOutIndex: BigInt(step.assetOutIndex),
    amount: BigInt(step.amount),
    userData: '0x' as `0x${string}`,
  }));

  const assetsData = action.assets.map((a) => a as `0x${string}`);

  const limitsData = action.assets.map((_, i) =>
    i === action.assets.length - 1 ? -BigInt(action.amountOutMin) : MAX_INT256,
  );

  // Placeholder addresses stand in for the two runtime values.
  const SENDER_PLACEHOLDER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
  const RECIPIENT_PLACEHOLDER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

  const encoded = encodeAbiParameters(
    [
      { type: 'uint8' },
      { type: 'tuple[]', components: [
        { type: 'bytes32', name: 'poolId' },
        { type: 'uint256', name: 'assetInIndex' },
        { type: 'uint256', name: 'assetOutIndex' },
        { type: 'uint256', name: 'amount' },
        { type: 'bytes', name: 'userData' },
      ]},
      { type: 'address[]' },
      { type: 'tuple', components: [
        { type: 'address', name: 'sender' },
        { type: 'bool', name: 'fromInternalBalance' },
        { type: 'address', name: 'recipient' },
        { type: 'bool', name: 'toInternalBalance' },
      ]},
      { type: 'int256[]' },
      { type: 'uint256' },
    ],
    [
      0,
      stepsData,
      assetsData,
      { sender: SENDER_PLACEHOLDER, fromInternalBalance: false, recipient: RECIPIENT_PLACEHOLDER, toInternalBalance: false },
      limitsData,
      BigInt(action.deadline),
    ],
  );

  const encodedBytes = hexToBytes(encoded);
  const senderPad = hexToBytes('0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const recipientPad = hexToBytes('0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  let senderOffset = -1;
  let recipientOffset = -1;
  for (let i = 0; i <= encodedBytes.length - 32; i++) {
    if (senderOffset === -1 && encodedBytes.slice(i, i + 32).every((b, j) => b === senderPad[j])) {
      senderOffset = i;
    }
    if (recipientOffset === -1 && encodedBytes.slice(i, i + 32).every((b, j) => b === recipientPad[j])) {
      recipientOffset = i;
    }
  }

  const sel = bindBytes(emit, 'sel', selector(
    'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
  ));

  // Build: selector + pre_sender + ctx.self() + between + recipient + post_recipient. Each pre-
  // encoded run is a bound `hex` const, because a method call's receiver must be an identifier.
  const stmts: Stmt[] = [...sel.stmts];
  const parts: Expr[] = [];
  const chunk = (from: number, to: number): void => {
    const bound = bindBytes(emit, 'bs', encodedBytes.slice(from, to));
    stmts.push(...bound.stmts);
    parts.push(bound.expr);
  };

  if (senderOffset < recipientOffset) {
    chunk(0, senderOffset);
    parts.push(encodeArgs([SELF]));
    chunk(senderOffset + 32, recipientOffset);
    parts.push(encodeArgs([recipientExpr]));
    chunk(recipientOffset + 32, encodedBytes.length);
  } else {
    chunk(0, recipientOffset);
    parts.push(encodeArgs([recipientExpr]));
    chunk(recipientOffset + 32, senderOffset);
    parts.push(encodeArgs([SELF]));
    chunk(senderOffset + 32, encodedBytes.length);
  }

  stmts.push(`${evmCall(word(action.vault), ZERO, concatCalldata(sel.expr, parts))};`);

  return { stmts, output: amountIn };
}

// ---------------------------------------------------------------------------
// New AMM swap actions
// ---------------------------------------------------------------------------

function uniswapV2Swap(emit: Emitter, action: UniswapV2SwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const cd = calldata(emit, 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', [
    amountIn,
    word(action.amountOutMin),
    arrayLiteral(action.path.map(word)),
    recipient,
    word(action.deadline),
  ]);
  const swap: Stmt[] = [...cd.stmts, `${evmCall(word(action.router), ZERO, cd.expr)};`];
  if (!needsOutput) return { stmts: swap, output: amountIn };

  // swapExactTokensForTokens returns `uint256[] memory amounts` — decoding the first 32 bytes as a
  // uint256 yields the ABI offset (0x20), not the output amount. Snapshot the tokenOut balance
  // pre/post instead.
  const tokenOut = word(action.path[action.path.length - 1]);
  const pre = selfBalance(emit, tokenOut);
  const post = selfBalance(emit, tokenOut);
  const delta = bindConst(emit, 'delta', `${post.expr} - ${pre.expr}`);

  return {
    stmts: [...pre.stmts, ...swap, ...post.stmts, ...delta.stmts],
    output: delta.expr,
  };
}

function curveRouterNGSwap(emit: Emitter, action: CurveRouterNGSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  // Pad route to 11 entries
  const route = [...action.route];
  while (route.length < 11) route.push('0x0000000000000000000000000000000000000000');
  // Pad swapParams to 5x5
  const swapParams: [number, number, number, number, number][] = [...action.swapParams];
  while (swapParams.length < 5) swapParams.push([0, 0, 0, 0, 0]);
  // Pad pools to 5
  const pools = [...action.pools];
  while (pools.length < 5) pools.push('0x0000000000000000000000000000000000000000');

  const cd = calldata(emit, 'exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)', [
    tuple(route.map(word)),
    tuple(swapParams.map((row) => tuple(row.map(word)))),
    amountIn,
    word(action.amountOutMin),
    tuple(pools.map(word)),
    recipient,
  ]);

  return capturedCall(emit, needsOutput, word(action.router), ZERO, cd, amountIn);
}

function balancerV3Swap(emit: Emitter, action: BalancerV3SwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  // BalancerV3 Router sends output to msg.sender; no recipient parameter in the function
  const userData = bindBytes(emit, 'ud', new Uint8Array(0));
  const cd = calldata(emit, 'swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)', [
    word(action.pool),
    word(action.tokenIn),
    word(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    word(action.deadline),
    flag(action.wethIsEth),
    userData.expr,
  ]);

  return capturedCall(
    emit,
    needsOutput,
    word(action.router),
    ZERO,
    { stmts: [...userData.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function ambientSwap(emit: Emitter, action: AmbientSwapAction, amountIn: Expr): ActionResult {
  // abi.encode(base, quote, poolIdx, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags)
  const cmd = bindConst(emit, 'cmd', encodeArgs([
    word(action.base),
    word(action.quote),
    word(action.poolIdx),
    flag(action.isBuy),
    flag(action.inBaseQty),
    amountIn,
    word(action.tip),
    word(action.limitPrice),
    word(action.minOut),
    word(action.reserveFlags),
  ]));
  const cd = calldata(emit, 'userCmd(uint16,bytes)', ['1n', cmd.expr]);

  return voidCall(word(action.dex), ZERO, { stmts: [...cmd.stmts, ...cd.stmts], expr: cd.expr }, amountIn);
}

function dodoSwap(emit: Emitter, action: DODOSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  // The DODO proxy sends output to msg.sender; we return the proxy's own return value.
  const sig = action.version === 'v1'
    ? 'dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)'
    : 'dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)';
  const cd = calldata(emit, sig, [
    word(action.fromToken),
    word(action.toToken),
    amountIn,
    word(action.amountOutMin),
    arrayLiteral(action.dodoPairs.map(word)),
    word(action.directions),
    ZERO, // isIncentive = false
    word(action.deadline),
  ]);

  return capturedCall(emit, needsOutput, word(action.proxy), ZERO, cd, amountIn);
}

function maverickSwap(emit: Emitter, action: MaverickSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const cd = calldata(emit, 'exactInputSingle(address,address,bool,uint256,uint256)', [
    recipient,
    word(action.pool),
    flag(action.tokenAIn),
    amountIn,
    word(action.amountOutMin),
  ]);

  return capturedCall(emit, needsOutput, word(action.router), ZERO, cd, amountIn);
}

function maverickMultiHopSwap(emit: Emitter, action: MaverickMultiHopSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const path = bindBytes(emit, 'path', hexToBytes(action.path));
  const cd = calldata(emit, 'exactInputMultiHop(address,bytes,uint256,uint256)', [
    recipient,
    path.expr,
    amountIn,
    word(action.amountOutMin),
  ]);

  return capturedCall(
    emit,
    needsOutput,
    word(action.router),
    ZERO,
    { stmts: [...path.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function carbonSwap(emit: Emitter, action: CarbonSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  // Carbon doesn't support a recipient override.
  const tradeActions = action.tradeActions.map((ta) => tuple([word(ta.strategyId), word(ta.amount)]));
  const cd = calldata(emit, 'tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)', [
    word(action.sourceToken),
    word(action.targetToken),
    arrayLiteral(tradeActions),
    word(action.deadline),
    word(action.amountOutMin),
  ]);

  return capturedCall(emit, needsOutput, word(action.controller), ZERO, cd, amountIn);
}

function fraxswapSwap(emit: Emitter, action: FraxswapSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const cd = calldata(emit, 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', [
    amountIn,
    word(action.amountOutMin),
    arrayLiteral(action.path.map(word)),
    recipient,
    word(action.deadline),
  ]);

  return capturedCall(emit, needsOutput, word(action.router), ZERO, cd, amountIn);
}

function clipperSwap(emit: Emitter, action: ClipperSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  // Clipper uses pre-transferred tokens, so the amount is implicit.
  const recipient = needsOutput ? SELF : word(action.recipient);
  const aux = bindBytes(emit, 'aux', hexToBytes(action.auxiliaryData));
  const cd = calldata(emit, 'sellTokenForToken(address,address,address,uint256,bytes)', [
    word(action.inputToken),
    word(action.outputToken),
    recipient,
    word(action.amountOutMin),
    aux.expr,
  ]);

  return capturedCall(
    emit,
    needsOutput,
    word(action.exchange),
    ZERO,
    { stmts: [...aux.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function integralSwap(emit: Emitter, action: IntegralSwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const params = tuple([
    word(action.tokenIn),
    word(action.tokenOut),
    amountIn,
    word(action.amountOutMin),
    flag(action.wrapUnwrap),
    recipient,
    word(action.gasLimit),
    word(action.submitDeadline),
  ]);
  const cd = calldata(emit, 'sell((address,address,uint256,uint256,bool,address,uint256,uint32))', [params]);

  return capturedCall(emit, needsOutput, word(action.delay), ZERO, cd, amountIn);
}

function fluidDexT1Swap(emit: Emitter, action: FluidDexT1SwapAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const recipient = needsOutput ? SELF : word(action.recipient);
  const cd = calldata(emit, 'swapIn(bool,uint256,uint256,address)', [
    flag(action.swap0to1),
    amountIn,
    word(action.amountOutMin),
    recipient,
  ]);

  return capturedCall(emit, needsOutput, word(action.pool), ZERO, cd, amountIn);
}

function fluidDexLiteSwap(emit: Emitter, action: FluidDexLiteSwapAction, amountIn: Expr): ActionResult {
  // DexKey is a tuple: (token0, token1, salt)
  const dexKey = tuple([word(action.token0), word(action.token1), word(action.salt)]);
  const cd = calldata(emit, 'swapSingle((address,address,bytes32),bool,int256,uint256,address)', [
    dexKey,
    flag(action.swap0To1),
    amountIn, // positive = exact input
    word(action.amountOutMin),
    word(action.recipient),
  ]);

  return voidCall(word(action.dex), ZERO, cd, amountIn);
}

// ---------------------------------------------------------------------------
// Transfer & approve — void output (pass-through amount)
// ---------------------------------------------------------------------------

function transfer(emit: Emitter, action: TransferAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'transfer(address,uint256)', [word(action.to), amountIn]);

  return voidCall(word(action.token), ZERO, cd, amountIn);
}

function approve(emit: Emitter, action: ApproveAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'approve(address,uint256)', [word(action.spender), amountIn]);

  return voidCall(word(action.token), ZERO, cd, amountIn);
}

// ---------------------------------------------------------------------------
// Wrap / Unwrap — void output (pass-through amount)
// ---------------------------------------------------------------------------

function wrapETH(emit: Emitter, action: WrapETHAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.weth), amountIn, calldata(emit, 'deposit()', []), amountIn);
}

function unwrapETH(emit: Emitter, action: UnwrapETHAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.weth), ZERO, calldata(emit, 'withdraw(uint256)', [amountIn]), amountIn);
}

function wrapStETH(emit: Emitter, action: WrapStETHAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.wstETH), ZERO, calldata(emit, 'wrap(uint256)', [amountIn]), amountIn);
}

function unwrapStETH(emit: Emitter, action: UnwrapStETHAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.wstETH), ZERO, calldata(emit, 'unwrap(uint256)', [amountIn]), amountIn);
}

// ---------------------------------------------------------------------------
// Liquid staking — void output (pass-through amount)
// ---------------------------------------------------------------------------

function lidoStake(emit: Emitter, action: LidoStakeAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'submit(address)', [word(action.referral)]);

  return voidCall(word(action.stETH), amountIn, cd, amountIn);
}

function lidoUnstake(emit: Emitter, action: LidoUnstakeAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'requestWithdrawals(uint256[],address)', [arrayLiteral([amountIn]), MSG_SENDER]);

  return voidCall(word(action.withdrawalQueue), ZERO, cd, amountIn);
}

function rocketPoolStake(emit: Emitter, action: RocketPoolStakeAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.depositPool), amountIn, calldata(emit, 'deposit()', []), amountIn);
}

function rocketPoolUnstake(emit: Emitter, action: RocketPoolUnstakeAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.rETH), ZERO, calldata(emit, 'burn(uint256)', [amountIn]), amountIn);
}

function coinbaseStake(emit: Emitter, action: CoinbaseStakeAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.cbETH), amountIn, calldata(emit, 'deposit()', []), amountIn);
}

function etherFiStake(emit: Emitter, action: EtherFiStakeAction, amountIn: Expr): ActionResult {
  return voidCall(word(action.liquidityPool), amountIn, calldata(emit, 'deposit()', []), amountIn);
}

// ---------------------------------------------------------------------------
// Lending / Borrowing — void output (pass-through amount)
// ---------------------------------------------------------------------------

function aaveV3Supply(emit: Emitter, action: AaveV3SupplyAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'supply(address,uint256,address,uint16)', [
    word(action.token),
    amountIn,
    word(action.onBehalfOf),
    word(action.referralCode),
  ]);

  return voidCall(word(action.pool), ZERO, cd, amountIn);
}

function aaveV3Withdraw(emit: Emitter, action: AaveV3WithdrawAction, amountIn: Expr, needsOutput: boolean): ActionResult {
  const cd = calldata(emit, 'withdraw(address,uint256,address)', [
    word(action.token),
    amountIn,
    word(action.to),
  ]);

  return capturedCall(emit, needsOutput, word(action.pool), ZERO, cd, amountIn);
}

function aaveV3Borrow(emit: Emitter, action: AaveV3BorrowAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'borrow(address,uint256,uint256,uint16,address)', [
    word(action.token),
    amountIn,
    word(action.interestRateMode),
    word(action.referralCode),
    word(action.onBehalfOf),
  ]);

  return voidCall(word(action.pool), ZERO, cd, amountIn);
}

function aaveV3Repay(emit: Emitter, action: AaveV3RepayAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'repay(address,uint256,uint256,address)', [
    word(action.token),
    amountIn,
    word(action.interestRateMode),
    word(action.onBehalfOf),
  ]);

  return voidCall(word(action.pool), ZERO, cd, amountIn);
}

function compoundV3Supply(emit: Emitter, action: CompoundV3SupplyAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'supply(address,uint256)', [word(action.token), amountIn]);

  return voidCall(word(action.comet), ZERO, cd, amountIn);
}

function compoundV3Withdraw(emit: Emitter, action: CompoundV3WithdrawAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'withdraw(address,uint256)', [word(action.token), amountIn]);

  return voidCall(word(action.comet), ZERO, cd, amountIn);
}

// ---------------------------------------------------------------------------
// Bridge actions — void output (pass-through amount)
// ---------------------------------------------------------------------------

function acrossBridge(emit: Emitter, action: AcrossBridgeAction, amountIn: Expr): ActionResult {
  const message = bindBytes(emit, 'msg', hexToBytes(action.message));
  const cd = calldata(
    emit,
    'depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)',
    [
      MSG_SENDER,                        // depositor
      MSG_SENDER,                        // recipient
      word(action.token),                // inputToken
      word(action.token),                // outputToken (same for simple bridge)
      amountIn,                          // inputAmount
      amountIn,                          // outputAmount
      word(action.destChainId),          // destinationChainId
      ZERO,                              // exclusiveRelayer (none)
      word(action.quoteTimestamp),
      word(action.fillDeadline),
      word(action.exclusivityDeadline),
      message.expr,
    ],
  );

  return voidCall(
    word(action.spokePool),
    ZERO,
    { stmts: [...message.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function stargateBridge(emit: Emitter, action: StargateBridgeAction, amountIn: Expr): ActionResult {
  const payload = bindBytes(emit, 'pl', new Uint8Array(0));
  const cd = calldata(emit, 'swap(uint16,uint256,uint256,address,uint256,uint256,(address,address,bytes))', [
    word(action.destChainId),
    word(action.srcPoolId),
    word(action.dstPoolId),
    MSG_SENDER,
    amountIn,
    word(action.amountOutMin),
    tuple([MSG_SENDER, MSG_SENDER, payload.expr]),
  ]);

  return voidCall(
    word(action.router),
    word(action.lzFee),
    { stmts: [...payload.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}

function cctpBridge(emit: Emitter, action: CCTPBridgeAction, amountIn: Expr): ActionResult {
  const cd = calldata(emit, 'depositForBurn(uint256,uint32,bytes32,address)', [
    amountIn,
    word(action.destDomain),
    word(action.mintRecipient),
    word(action.token),
  ]);

  return voidCall(word(action.tokenMessenger), ZERO, cd, amountIn);
}

function hyperlaneBridge(emit: Emitter, action: HyperlaneBridgeAction, amountIn: Expr): ActionResult {
  const body = bindBytes(emit, 'body', new Uint8Array(0));
  const cd = calldata(emit, 'dispatch(uint32,bytes32,bytes)', [
    word(action.destinationDomain),
    word(action.token),
    body.expr,
  ]);

  return voidCall(
    word(action.router),
    word(action.gasPayment),
    { stmts: [...body.stmts, ...cd.stmts], expr: cd.expr },
    amountIn,
  );
}
