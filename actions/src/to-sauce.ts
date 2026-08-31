import { Saucer, CompilerContext, OPS, type OutputSpec } from '../../compiler/dist/index.js';
import { keccak256, toBytes, encodeAbiParameters } from 'viem';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** OutputSpec for a single uint256 return value. */
const UINT256_OUTPUT: OutputSpec = { count: 1, typeSpecs: [OPS.BYTE_32] };

/** V4 ActionConstants.CONTRACT_BALANCE — signals the router to use its own token balance. */
const V4_CONTRACT_BALANCE = BigInt('0x8000000000000000000000000000000000000000000000000000000000000000');

/** V4 ActionConstants.OPEN_DELTA — signals "take all owed" in a TAKE action. */
const V4_OPEN_DELTA = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Compute 4-byte selector from a Solidity function signature. */
function selector(sig: string): Uint8Array {
  const hash = keccak256(toBytes(sig));
  return hexToBytes(hash.slice(0, 10)); // "0x" + 8 hex chars = 4 bytes
}

/** Build calldata: 4-byte selector + abiEncode(tuple(args)). */
function calldata(s: Saucer, sig: string, args: Saucer[]): Saucer {
  const sel = s.bytes(selector(sig));
  if (args.length === 0) return sel;
  return s.concat([sel, s.abiEncode(s.tuple(args))]);
}

// ---------------------------------------------------------------------------
// Amount resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the amount for an action:
 * 1. Explicit amount string (highest priority)
 * 2. amountRef — read from a named slot
 * 3. lastOutputSlot — implicit chain from previous action
 */
function resolveAmountIn(
  s: Saucer,
  explicitAmount: string | undefined,
  amountRef: string | undefined,
  lastOutputSlot: string | undefined,
): Saucer {
  if (explicitAmount !== undefined) return s.int(BigInt(explicitAmount));
  if (amountRef !== undefined) return s.read(amountRef);
  if (lastOutputSlot !== undefined) return s.read(lastOutputSlot);
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

interface ActionResult {
  /** Bytecode for the call (may include ABI_DECODE for return-value capture). */
  call: Saucer;
  /**
   * The output value expression for chaining.
   * - For swaps: the decoded return value (same Saucer as `call`).
   * - For void actions: the input amountIn (pass-through).
   */
  output: Saucer;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function actionsToSauce(actions: RoutingAction[]): Uint8Array {
  if (actions.length === 0) return new Uint8Array();

  const ctx = new CompilerContext();
  const s = new Saucer(ctx);

  let chain = s; // accumulator — starts empty
  let lastOutputSlot: string | undefined;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const amountIn = resolveAmountIn(
      s,
      getExplicitAmount(action),
      action.amountRef,
      lastOutputSlot,
    );

    // Determine if we need to store the output
    const needsStore =
      action.saveOutputAs !== undefined ||
      actions.slice(i + 1).some(
        (a) =>
          getExplicitAmount(a) === undefined && a.amountRef === undefined,
      ) ||
      actions.slice(i + 1).some(
        (a) => a.amountRef === action.saveOutputAs,
      );

    const result = buildAction(s, action, amountIn, needsStore);

    if (needsStore) {
      const outputSlot = action.saveOutputAs ?? `__out_${i}`;

      if (result.output === result.call) {
        // Output IS the call result — storing it implicitly executes the call
        chain = chain.join(s.store(outputSlot, result.output));
      } else {
        // Void call — execute it, then store the pass-through output
        chain = chain.join(result.call).join(s.store(outputSlot, result.output));
      }

      lastOutputSlot = outputSlot;
    } else {
      // No chaining needed — just execute the call
      chain = chain.join(result.call);
    }
  }

  return chain.build();
}

export function actionToSauce(action: RoutingAction): Uint8Array {
  return actionsToSauce([action]);
}

export type { ActionResult };

export function buildAction(s: Saucer, action: RoutingAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  switch (action.type) {
    case 'uniswapV3ExactInput':        return uniswapV3ExactInput(s, action, amountIn, outputChained);
    case 'uniswapV3ExactInputMultiHop': return uniswapV3ExactInputMultiHop(s, action, amountIn, outputChained);
    case 'uniswapV4ExactInput':        return uniswapV4ExactInput(s, action, amountIn);
    case 'uniswapV4ExactInputMultiHop': return uniswapV4ExactInputMultiHop(s, action, amountIn);
    case 'curveSwap':                  return curveSwap(s, action, amountIn, outputChained);
    case 'balancerV2Swap':             return balancerV2Swap(s, action, amountIn, outputChained);
    case 'balancerV2BatchSwap':        return balancerV2BatchSwap(s, action, amountIn, outputChained);
    case 'balancerV3Swap':             return balancerV3Swap(s, action, amountIn, outputChained);
    case 'uniswapV2Swap':              return uniswapV2Swap(s, action, amountIn, outputChained);
    case 'curveRouterNGSwap':          return curveRouterNGSwap(s, action, amountIn, outputChained);
    case 'ambientSwap':                return ambientSwap(s, action, amountIn);
    case 'dodoSwap':                   return dodoSwap(s, action, amountIn, outputChained);
    case 'maverickSwap':               return maverickSwap(s, action, amountIn, outputChained);
    case 'maverickMultiHopSwap':       return maverickMultiHopSwap(s, action, amountIn, outputChained);
    case 'carbonSwap':                 return carbonSwap(s, action, amountIn, outputChained);
    case 'fraxswapSwap':               return fraxswapSwap(s, action, amountIn, outputChained);
    case 'clipperSwap':                return clipperSwap(s, action, amountIn, outputChained);
    case 'integralSwap':               return integralSwap(s, action, amountIn, outputChained);
    case 'fluidDexT1Swap':             return fluidDexT1Swap(s, action, amountIn, outputChained);
    case 'fluidDexLiteSwap':           return fluidDexLiteSwap(s, action, amountIn);
    case 'transfer':                   return transfer(s, action, amountIn);
    case 'approve':                    return approve(s, action, amountIn);
    case 'wrapETH':                    return wrapETH(s, action, amountIn);
    case 'unwrapETH':                  return unwrapETH(s, action, amountIn);
    case 'wrapStETH':                  return wrapStETH(s, action, amountIn);
    case 'unwrapStETH':                return unwrapStETH(s, action, amountIn);
    case 'lidoStake':                  return lidoStake(s, action, amountIn);
    case 'lidoUnstake':                return lidoUnstake(s, action, amountIn);
    case 'rocketPoolStake':            return rocketPoolStake(s, action, amountIn);
    case 'rocketPoolUnstake':          return rocketPoolUnstake(s, action, amountIn);
    case 'coinbaseStake':              return coinbaseStake(s, action, amountIn);
    case 'etherFiStake':               return etherFiStake(s, action, amountIn);
    case 'aaveV3Supply':               return aaveV3Supply(s, action, amountIn);
    case 'aaveV3Withdraw':             return aaveV3Withdraw(s, action, amountIn);
    case 'aaveV3Borrow':               return aaveV3Borrow(s, action, amountIn);
    case 'aaveV3Repay':                return aaveV3Repay(s, action, amountIn);
    case 'compoundV3Supply':           return compoundV3Supply(s, action, amountIn);
    case 'compoundV3Withdraw':         return compoundV3Withdraw(s, action, amountIn);
    case 'acrossBridge':               return acrossBridge(s, action, amountIn);
    case 'stargateBridge':             return stargateBridge(s, action, amountIn);
    case 'cctpBridge':                 return cctpBridge(s, action, amountIn);
    case 'hyperlaneBridge':            return hyperlaneBridge(s, action, amountIn);
    default: {
      const _: never = action;
      throw new Error(`Unknown action type: ${(_ as any).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Swap actions — capture uint256 output
// ---------------------------------------------------------------------------

function uniswapV3ExactInput(s: Saucer, action: UniswapV3ExactInputAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const params = s.tuple([
    s.int(BigInt(action.tokenIn)),
    s.int(BigInt(action.tokenOut)),
    s.int(BigInt(action.fee)),
    recipient,
    amountIn,
    s.int(BigInt(action.amountOutMin ?? '0')),
    s.int(BigInt(action.sqrtPriceLimitX96 ?? '0')),
  ]);
  const cd = calldata(
    s,
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    [params],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function uniswapV3ExactInputMultiHop(s: Saucer, action: UniswapV3ExactInputMultiHopAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const params = s.tuple([
    s.bytes(hexToBytes(action.path)),
    recipient,
    amountIn,
    s.int(BigInt(action.amountOutMin)),
  ]);
  const cd = calldata(
    s,
    'exactInput((bytes,address,uint256,uint256))',
    [params],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function uniswapV4ExactInput(s: Saucer, action: UniswapV4ExactInputAction, amountIn: Saucer): ActionResult {
  const currencyIn = action.zeroForOne ? action.poolKey.currency0 : action.poolKey.currency1;
  const currencyOut = action.zeroForOne ? action.poolKey.currency1 : action.poolKey.currency0;

  // Transfer input token to the router so it can settle without Permit2
  const transferCd = calldata(s, 'transfer(address,uint256)', [
    s.int(BigInt(action.router)),
    amountIn,
  ]);
  const transferCall = s.externalCall(s.int(BigInt(currencyIn)), s.int(0n), transferCd);

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

  // Actions: SWAP_EXACT_IN_SINGLE (0x06), SETTLE (0x0b), TAKE (0x0e)
  const v4Input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    ['0x060b0e', [swapParams, settleParams, takeParams]],
  );

  const executeCalldata = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    ['0x10', [v4Input]],
  );

  const cd = s.concat([
    s.bytes(selector('execute(bytes,bytes[])')),
    s.bytes(hexToBytes(executeCalldata)),
  ]);

  const executeCall = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd);
  const call = transferCall.join(executeCall);
  return { call, output: amountIn };
}

function uniswapV4ExactInputMultiHop(s: Saucer, action: UniswapV4ExactInputMultiHopAction, amountIn: Saucer): ActionResult {
  const currencyOut = action.path[action.path.length - 1].intermediateCurrency;

  // Transfer input token to the router so it can settle without Permit2
  const transferCd = calldata(s, 'transfer(address,uint256)', [
    s.int(BigInt(action.router)),
    amountIn,
  ]);
  const transferCall = s.externalCall(s.int(BigInt(action.currencyIn)), s.int(0n), transferCd);

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

  // SETTLE (0x0b) with payerIsUser=false + CONTRACT_BALANCE (0) — router uses its own balance
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [action.currencyIn, V4_CONTRACT_BALANCE, false],
  );

  // TAKE (0x0e) — sends output to specified recipient, OPEN_DELTA = take all owed
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [currencyOut, action.recipient, V4_OPEN_DELTA],
  );

  // Actions: SWAP_EXACT_IN (0x07), SETTLE (0x0b), TAKE (0x0e)
  const v4Input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    ['0x070b0e', [swapParams, settleParams, takeParams]],
  );

  const executeCalldata = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    ['0x10', [v4Input]],
  );

  const cd = s.concat([
    s.bytes(selector('execute(bytes,bytes[])')),
    s.bytes(hexToBytes(executeCalldata)),
  ]);

  const executeCall = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd);
  const call = transferCall.join(executeCall);
  return { call, output: amountIn };
}

/**
 * Per-build counter for `curveSwap` scratch slots so multiple curve actions in
 * the same chain (or the same dispatcher) don't share a slot name and clobber
 * each other's pre/post snapshots.
 */
let curveScratchCounter = 0;

function curveSwap(s: Saucer, action: CurveSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  // Older Curve pools (e.g. 3pool at 0xbEbc44...) expose only the 4-arg
  // `exchange` which returns VOID and sends the output to msg.sender. We:
  //   1. snapshot Sauce's pre-swap `tokenOut` balance,
  //   2. call the 4-arg exchange (Sauce is msg.sender — output lands here),
  //   3. compute `post - pre` to recover this swap's output without sweeping
  //      any pre-existing dust / residual from earlier actions.
  //
  // Newer pools that support the 5-arg overload with receiver still work
  // here — they just end up sending to msg.sender too, so step 3 still runs.
  const id = curveScratchCounter++;
  const preBalSlot = `__curve_pre_${id}`;
  const balSlot = `__curve_bal_${id}`;

  const tokenOut = s.int(BigInt(action.tokenOut));
  const balOf = () =>
    s.externalCall(
      tokenOut,
      s.int(0n),
      calldata(s, 'balanceOf(address)', [s.addressSelf()]),
      UINT256_OUTPUT,
    );

  const exchangeCd = calldata(
    s,
    'exchange(int128,int128,uint256,uint256)',
    [
      s.int(BigInt(action.i)),
      s.int(BigInt(action.j)),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
    ],
  );

  const captureAndSwap = s
    .store(preBalSlot, balOf())
    .join(s.externalCall(s.int(BigInt(action.pool)), s.int(0n), exchangeCd));
  const swapOutput = s.sub(balOf(), s.read(preBalSlot));

  if (outputChained) {
    return { call: captureAndSwap, output: swapOutput };
  }
  // Non-chained: stash the delta and transfer it to the recipient.
  const forward = captureAndSwap
    .join(s.store(balSlot, swapOutput))
    .join(
      s.externalCall(
        tokenOut,
        s.int(0n),
        calldata(s, 'transfer(address,uint256)', [
          s.int(BigInt(action.recipient)),
          s.read(balSlot),
        ]),
      ),
    );
  return { call: forward, output: s.read(balSlot) };
}

function balancerV2Swap(s: Saucer, action: BalancerV2SwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const singleSwap = s.tuple([
    s.int(BigInt(action.poolId)), // bytes32 — must be static, not dynamic bytes
    s.int(0n), // kind = GIVEN_IN
    s.int(BigInt(action.tokenIn)),
    s.int(BigInt(action.tokenOut)),
    amountIn,
    s.bytes(new Uint8Array(0)), // empty userData
  ]);
  const funds = s.tuple([
    s.addressSelf(),  // sender — must equal msg.sender (Sauce) for vault auth
    s.int(0n),
    recipient,        // recipient — Sauce when chaining, caller otherwise
    s.int(0n),
  ]);
  const cd = calldata(
    s,
    'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)',
    [singleSwap, funds, s.int(BigInt(action.amountOutMin)), s.int(BigInt(action.deadline))],
  );
  const call = s.externalCall(s.int(BigInt(action.vault)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function balancerV2BatchSwap(s: Saucer, action: BalancerV2BatchSwapAction, _amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipientExpr = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  // Pre-encode the complex calldata using viem, then splice in runtime values
  // for funds.sender (addressSelf) and funds.recipient (msgSender)
  const MAX_INT256 = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819967');

  const stepsData = action.steps.map((step) => ({
    poolId: step.poolId as `0x${string}`,
    assetInIndex: BigInt(step.assetInIndex),
    assetOutIndex: BigInt(step.assetOutIndex),
    amount: BigInt(step.amount),
    userData: '0x' as `0x${string}`,
  }));

  const assetsData = action.assets.map(a => a as `0x${string}`);

  const limitsData = action.assets.map((_, i) =>
    i === action.assets.length - 1
      ? -BigInt(action.amountOutMin)
      : MAX_INT256,
  );

  // Encode the full calldata with placeholder addresses for sender/recipient
  // Sender placeholder: 0xaaaa...aaaa, recipient placeholder: 0xbbbb...bbbb
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

  // Find sender/recipient placeholder positions in the encoded data and replace with runtime values
  const encodedBytes = hexToBytes(encoded);
  const senderPad = hexToBytes('0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const recipientPad = hexToBytes('0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  // Build calldata by replacing placeholders
  const sel = selector('batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)');

  // Find placeholder offsets in encoded data
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

  // Build: selector + pre_sender + addressSelf + between + recipient + post_recipient
  const parts: Saucer[] = [s.bytes(sel)];

  if (senderOffset < recipientOffset) {
    parts.push(s.bytes(encodedBytes.slice(0, senderOffset)));
    parts.push(s.abiEncode(s.tuple([s.addressSelf()])));
    parts.push(s.bytes(encodedBytes.slice(senderOffset + 32, recipientOffset)));
    parts.push(s.abiEncode(s.tuple([recipientExpr])));
    parts.push(s.bytes(encodedBytes.slice(recipientOffset + 32)));
  } else {
    parts.push(s.bytes(encodedBytes.slice(0, recipientOffset)));
    parts.push(s.abiEncode(s.tuple([recipientExpr])));
    parts.push(s.bytes(encodedBytes.slice(recipientOffset + 32, senderOffset)));
    parts.push(s.abiEncode(s.tuple([s.addressSelf()])));
    parts.push(s.bytes(encodedBytes.slice(senderOffset + 32)));
  }

  const cd = s.concat(parts);
  const call = s.externalCall(s.int(BigInt(action.vault)), s.int(0n), cd);
  return { call, output: _amountIn };
}

// ---------------------------------------------------------------------------
// New AMM swap actions
// ---------------------------------------------------------------------------

let v2ScratchCounter = 0;

function uniswapV2Swap(s: Saucer, action: UniswapV2SwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    [
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.array(action.path.map((addr) => s.int(BigInt(addr)))),
      recipient,
      s.int(BigInt(action.deadline)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd);
  if (!outputChained) return { call, output: call };

  // swapExactTokensForTokens returns `uint256[] memory amounts` — decoding the
  // first 32 bytes (UINT256_OUTPUT) yields the ABI offset (0x20), not the
  // output amount. Snapshot Sauce's tokenOut balance pre/post instead.
  const tokenOut = s.int(BigInt(action.path[action.path.length - 1]));
  const id = v2ScratchCounter++;
  const preSlot = `__v2_pre_${id}`;
  const balOf = () =>
    s.externalCall(
      tokenOut,
      s.int(0n),
      calldata(s, 'balanceOf(address)', [s.addressSelf()]),
      UINT256_OUTPUT,
    );
  const captureAndSwap = s.store(preSlot, balOf()).join(call);
  return { call: captureAndSwap, output: s.sub(balOf(), s.read(preSlot)) };
}

function curveRouterNGSwap(s: Saucer, action: CurveRouterNGSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  // Pad route to 11 entries
  const route = [...action.route];
  while (route.length < 11) route.push('0x0000000000000000000000000000000000000000');
  // Pad swapParams to 5x5
  const swapParams: [number, number, number, number, number][] = [...action.swapParams];
  while (swapParams.length < 5) swapParams.push([0, 0, 0, 0, 0]);
  // Pad pools to 5
  const pools = [...action.pools];
  while (pools.length < 5) pools.push('0x0000000000000000000000000000000000000000');

  const routeArgs = route.map((addr) => s.int(BigInt(addr)));
  const swapParamArgs = swapParams.map((row) =>
    s.tuple(row.map((v) => s.int(BigInt(v)))),
  );
  const poolArgs = pools.map((addr) => s.int(BigInt(addr)));

  const cd = calldata(
    s,
    'exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)',
    [
      s.tuple(routeArgs),
      s.tuple(swapParamArgs),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.tuple(poolArgs),
      recipient,
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function balancerV3Swap(s: Saucer, action: BalancerV3SwapAction, amountIn: Saucer, _outputChained: boolean): ActionResult {
  // BalancerV3 Router sends output to msg.sender; no recipient parameter in the function
  const cd = calldata(
    s,
    'swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)',
    [
      s.int(BigInt(action.pool)),
      s.int(BigInt(action.tokenIn)),
      s.int(BigInt(action.tokenOut)),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.int(BigInt(action.deadline)),
      s.int(action.wethIsEth ? 1n : 0n),
      s.bytes(new Uint8Array(0)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function ambientSwap(s: Saucer, action: AmbientSwapAction, amountIn: Saucer): ActionResult {
  // Encode the swap command as: abi.encode(base, quote, poolIdx, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags)
  const cmd = s.abiEncode(s.tuple([
    s.int(BigInt(action.base)),
    s.int(BigInt(action.quote)),
    s.int(BigInt(action.poolIdx)),
    s.int(action.isBuy ? 1n : 0n),
    s.int(action.inBaseQty ? 1n : 0n),
    amountIn,
    s.int(BigInt(action.tip)),
    s.int(BigInt(action.limitPrice)),
    s.int(BigInt(action.minOut)),
    s.int(BigInt(action.reserveFlags)),
  ]));
  const cd = calldata(s, 'userCmd(uint16,bytes)', [s.int(1n), cmd]);
  const call = s.externalCall(s.int(BigInt(action.dex)), s.int(0n), cd);
  return { call, output: amountIn };
}

function dodoSwap(s: Saucer, action: DODOSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  void outputChained; // DODO proxy sends output to msg.sender; we return the proxy's return value
  const fn = action.version === 'v1'
    ? 'dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)'
    : 'dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)';
  const cd = calldata(
    s,
    fn,
    [
      s.int(BigInt(action.fromToken)),
      s.int(BigInt(action.toToken)),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.array(action.dodoPairs.map((addr) => s.int(BigInt(addr)))),
      s.int(BigInt(action.directions)),
      s.int(0n), // isIncentive = false
      s.int(BigInt(action.deadline)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.proxy)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function maverickSwap(s: Saucer, action: MaverickSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'exactInputSingle(address,address,bool,uint256,uint256)',
    [
      recipient,
      s.int(BigInt(action.pool)),
      s.int(action.tokenAIn ? 1n : 0n),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function maverickMultiHopSwap(s: Saucer, action: MaverickMultiHopSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'exactInputMultiHop(address,bytes,uint256,uint256)',
    [
      recipient,
      s.bytes(hexToBytes(action.path)),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function carbonSwap(s: Saucer, action: CarbonSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  void outputChained; // Carbon doesn't support recipient override
  const tradeActionTuples = action.tradeActions.map((ta) =>
    s.tuple([s.int(BigInt(ta.strategyId)), s.int(BigInt(ta.amount))]),
  );
  const cd = calldata(
    s,
    'tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)',
    [
      s.int(BigInt(action.sourceToken)),
      s.int(BigInt(action.targetToken)),
      s.array(tradeActionTuples),
      s.int(BigInt(action.deadline)),
      s.int(BigInt(action.amountOutMin)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.controller)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function fraxswapSwap(s: Saucer, action: FraxswapSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    [
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.array(action.path.map((addr) => s.int(BigInt(addr)))),
      recipient,
      s.int(BigInt(action.deadline)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function clipperSwap(s: Saucer, action: ClipperSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  void amountIn; // Clipper uses pre-transferred tokens, amount is implicit
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'sellTokenForToken(address,address,address,uint256,bytes)',
    [
      s.int(BigInt(action.inputToken)),
      s.int(BigInt(action.outputToken)),
      recipient,
      s.int(BigInt(action.amountOutMin)),
      s.bytes(hexToBytes(action.auxiliaryData)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.exchange)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function integralSwap(s: Saucer, action: IntegralSwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const params = s.tuple([
    s.int(BigInt(action.tokenIn)),
    s.int(BigInt(action.tokenOut)),
    amountIn,
    s.int(BigInt(action.amountOutMin)),
    s.int(action.wrapUnwrap ? 1n : 0n),
    recipient,
    s.int(BigInt(action.gasLimit)),
    s.int(BigInt(action.submitDeadline)),
  ]);
  const cd = calldata(
    s,
    'sell((address,address,uint256,uint256,bool,address,uint256,uint32))',
    [params],
  );
  const call = s.externalCall(s.int(BigInt(action.delay)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function fluidDexT1Swap(s: Saucer, action: FluidDexT1SwapAction, amountIn: Saucer, outputChained: boolean): ActionResult {
  const recipient = outputChained ? s.addressSelf() : s.int(BigInt(action.recipient));
  const cd = calldata(
    s,
    'swapIn(bool,uint256,uint256,address)',
    [
      s.int(action.swap0to1 ? 1n : 0n),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      recipient,
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.pool)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function fluidDexLiteSwap(s: Saucer, action: FluidDexLiteSwapAction, amountIn: Saucer): ActionResult {
  // DexKey is a tuple: (token0, token1, salt)
  const dexKey = s.tuple([
    s.int(BigInt(action.token0)),
    s.int(BigInt(action.token1)),
    s.int(BigInt(action.salt)),
  ]);
  const cd = calldata(
    s,
    'swapSingle((address,address,bytes32),bool,int256,uint256,address)',
    [
      dexKey,
      s.int(action.swap0To1 ? 1n : 0n),
      amountIn, // positive = exact input
      s.int(BigInt(action.amountOutMin)),
      s.int(BigInt(action.recipient)),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.dex)), s.int(0n), cd);
  return { call, output: amountIn };
}

// ---------------------------------------------------------------------------
// Transfer & approve — void output (pass-through amount)
// ---------------------------------------------------------------------------

function transfer(s: Saucer, action: TransferAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'transfer(address,uint256)', [
    s.int(BigInt(action.to)),
    amountIn,
  ]);
  const call = s.externalCall(s.int(BigInt(action.token)), s.int(0n), cd);
  return { call, output: amountIn };
}

function approve(s: Saucer, action: ApproveAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'approve(address,uint256)', [
    s.int(BigInt(action.spender)),
    amountIn,
  ]);
  const call = s.externalCall(s.int(BigInt(action.token)), s.int(0n), cd);
  return { call, output: amountIn };
}

// ---------------------------------------------------------------------------
// Wrap / Unwrap — void output (pass-through amount)
// ---------------------------------------------------------------------------

function wrapETH(s: Saucer, action: WrapETHAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'deposit()', []);
  const call = s.externalCall(s.int(BigInt(action.weth)), amountIn, cd);
  return { call, output: amountIn };
}

function unwrapETH(s: Saucer, action: UnwrapETHAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'withdraw(uint256)', [amountIn]);
  const call = s.externalCall(s.int(BigInt(action.weth)), s.int(0n), cd);
  return { call, output: amountIn };
}

function wrapStETH(s: Saucer, action: WrapStETHAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'wrap(uint256)', [amountIn]);
  const call = s.externalCall(s.int(BigInt(action.wstETH)), s.int(0n), cd);
  return { call, output: amountIn };
}

function unwrapStETH(s: Saucer, action: UnwrapStETHAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'unwrap(uint256)', [amountIn]);
  const call = s.externalCall(s.int(BigInt(action.wstETH)), s.int(0n), cd);
  return { call, output: amountIn };
}

// ---------------------------------------------------------------------------
// Liquid staking — void output (pass-through amount)
// ---------------------------------------------------------------------------

function lidoStake(s: Saucer, action: LidoStakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'submit(address)', [s.int(BigInt(action.referral))]);
  const call = s.externalCall(s.int(BigInt(action.stETH)), amountIn, cd);
  return { call, output: amountIn };
}

function lidoUnstake(s: Saucer, action: LidoUnstakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'requestWithdrawals(uint256[],address)', [
    s.array([amountIn]),
    s.msgSender(),
  ]);
  const call = s.externalCall(s.int(BigInt(action.withdrawalQueue)), s.int(0n), cd);
  return { call, output: amountIn };
}

function rocketPoolStake(s: Saucer, action: RocketPoolStakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'deposit()', []);
  const call = s.externalCall(s.int(BigInt(action.depositPool)), amountIn, cd);
  return { call, output: amountIn };
}

function rocketPoolUnstake(s: Saucer, action: RocketPoolUnstakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'burn(uint256)', [amountIn]);
  const call = s.externalCall(s.int(BigInt(action.rETH)), s.int(0n), cd);
  return { call, output: amountIn };
}

function coinbaseStake(s: Saucer, action: CoinbaseStakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'deposit()', []);
  const call = s.externalCall(s.int(BigInt(action.cbETH)), amountIn, cd);
  return { call, output: amountIn };
}

function etherFiStake(s: Saucer, action: EtherFiStakeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'deposit()', []);
  const call = s.externalCall(s.int(BigInt(action.liquidityPool)), amountIn, cd);
  return { call, output: amountIn };
}

// ---------------------------------------------------------------------------
// Lending / Borrowing — void output (pass-through amount)
// ---------------------------------------------------------------------------

function aaveV3Supply(s: Saucer, action: AaveV3SupplyAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'supply(address,uint256,address,uint16)', [
    s.int(BigInt(action.token)),
    amountIn,
    s.int(BigInt(action.onBehalfOf)),
    s.int(BigInt(action.referralCode)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.pool)), s.int(0n), cd);
  return { call, output: amountIn };
}

function aaveV3Withdraw(s: Saucer, action: AaveV3WithdrawAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'withdraw(address,uint256,address)', [
    s.int(BigInt(action.token)),
    amountIn,
    s.int(BigInt(action.to)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.pool)), s.int(0n), cd, UINT256_OUTPUT);
  return { call, output: call };
}

function aaveV3Borrow(s: Saucer, action: AaveV3BorrowAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'borrow(address,uint256,uint256,uint16,address)', [
    s.int(BigInt(action.token)),
    amountIn,
    s.int(BigInt(action.interestRateMode)),
    s.int(BigInt(action.referralCode)),
    s.int(BigInt(action.onBehalfOf)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.pool)), s.int(0n), cd);
  return { call, output: amountIn };
}

function aaveV3Repay(s: Saucer, action: AaveV3RepayAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'repay(address,uint256,uint256,address)', [
    s.int(BigInt(action.token)),
    amountIn,
    s.int(BigInt(action.interestRateMode)),
    s.int(BigInt(action.onBehalfOf)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.pool)), s.int(0n), cd);
  return { call, output: amountIn };
}

function compoundV3Supply(s: Saucer, action: CompoundV3SupplyAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'supply(address,uint256)', [
    s.int(BigInt(action.token)),
    amountIn,
  ]);
  const call = s.externalCall(s.int(BigInt(action.comet)), s.int(0n), cd);
  return { call, output: amountIn };
}

function compoundV3Withdraw(s: Saucer, action: CompoundV3WithdrawAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'withdraw(address,uint256)', [
    s.int(BigInt(action.token)),
    amountIn,
  ]);
  const call = s.externalCall(s.int(BigInt(action.comet)), s.int(0n), cd);
  return { call, output: amountIn };
}

// ---------------------------------------------------------------------------
// Bridge actions — void output (pass-through amount)
// ---------------------------------------------------------------------------

function acrossBridge(s: Saucer, action: AcrossBridgeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(
    s,
    'depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)',
    [
      s.msgSender(),                           // depositor
      s.msgSender(),                           // recipient
      s.int(BigInt(action.token)),             // inputToken
      s.int(BigInt(action.token)),             // outputToken (same for simple bridge)
      amountIn,                                // inputAmount
      amountIn,                                // outputAmount
      s.int(BigInt(action.destChainId)),       // destinationChainId
      s.int(0n),                               // exclusiveRelayer (none)
      s.int(BigInt(action.quoteTimestamp)),     // quoteTimestamp
      s.int(BigInt(action.fillDeadline)),       // fillDeadline
      s.int(BigInt(action.exclusivityDeadline)), // exclusivityDeadline
      s.bytes(hexToBytes(action.message)),     // message
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.spokePool)), s.int(0n), cd);
  return { call, output: amountIn };
}

function stargateBridge(s: Saucer, action: StargateBridgeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(
    s,
    'swap(uint16,uint256,uint256,address,uint256,uint256,(address,address,bytes))',
    [
      s.int(BigInt(action.destChainId)),
      s.int(BigInt(action.srcPoolId)),
      s.int(BigInt(action.dstPoolId)),
      s.msgSender(),
      amountIn,
      s.int(BigInt(action.amountOutMin)),
      s.tuple([
        s.msgSender(),
        s.msgSender(),
        s.bytes(new Uint8Array(0)),
      ]),
    ],
  );
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(BigInt(action.lzFee)), cd);
  return { call, output: amountIn };
}

function cctpBridge(s: Saucer, action: CCTPBridgeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'depositForBurn(uint256,uint32,bytes32,address)', [
    amountIn,
    s.int(BigInt(action.destDomain)),
    s.int(BigInt(action.mintRecipient)),
    s.int(BigInt(action.token)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.tokenMessenger)), s.int(0n), cd);
  return { call, output: amountIn };
}

function hyperlaneBridge(s: Saucer, action: HyperlaneBridgeAction, amountIn: Saucer): ActionResult {
  const cd = calldata(s, 'dispatch(uint32,bytes32,bytes)', [
    s.int(BigInt(action.destinationDomain)),
    s.int(BigInt(action.token)),
    s.bytes(new Uint8Array(0)),
  ]);
  const call = s.externalCall(s.int(BigInt(action.router)), s.int(BigInt(action.gasPayment)), cd);
  return { call, output: amountIn };
}
