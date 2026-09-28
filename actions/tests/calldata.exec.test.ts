/**
 * Every action, EXECUTED through the released engine and a real Pot, against contracts that record
 * the calls they receive — then each recorded call compared byte for byte with an independent viem
 * encoding of the Solidity call the action is meant to make.
 *
 * This is the spec for the emitted calldata, and it needs no fork: the recorders stand in for the
 * protocols (see `anvil.ts#recorderCode`), and every one returns a single 32-byte word, which is
 * what each binding that declares an output decodes. Balance reads are answered but not recorded
 * (a view call is a STATICCALL, which cannot log), so a delta shows only the call between them. The expected encodings below are written from
 * the protocols' Solidity signatures, not from `abis.ts`, so a wrong fragment there fails here.
 *
 * Fork-free, so it runs in `test:unit`; it skips locally without the engine artifact and fails in CI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeFunctionData,
  pad,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { actionsToSauce } from "../src/to-sauce.js";
import type { RoutingAction } from "../src/types.js";
import { recordedCalls, recorderCode, skipReason, startAnvil, type Anvil } from "./anvil.js";

type A = Address;
const TARGET = "0x2000000000000000000000000000000000000001" as A;
const TOKEN = "0x1000000000000000000000000000000000000001" as A;
const TOKEN_OUT = "0x1000000000000000000000000000000000000002" as A;
const RECIPIENT = "0x3000000000000000000000000000000000000001" as A;
const ZERO = "0x0000000000000000000000000000000000000000" as A;
const RECORDERS = [TARGET, TOKEN, TOKEN_OUT];

const AMOUNT = 1_000_000n;
const MIN = 1n;
const DEADLINE = 9_999_999_999;
const WORD = pad("0x2a");
const MAX_INT256 = (1n << 255n) - 1n;

const call = (abi: string, name: string, args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: parseAbi([abi]) as Abi, functionName: name, args });

interface Expected {
  readonly to: A;
  readonly data: Hex;
  readonly value?: bigint;
}

interface Case {
  readonly action: RoutingAction;
  /** The calls the action makes, in order, given the executing Pot's address. */
  readonly expect: (pot: A) => readonly Expected[];
}

const V4_KEY = { currency0: TOKEN, currency1: TOKEN_OUT, fee: 500, tickSpacing: 10, hooks: ZERO };

/** The Universal Router input of a V4 swap: swap, settle from the router's own balance, take all. */
function v4Execute(swapAction: number, swapParams: Hex, currencyIn: A, currencyOut: A, to: A): Hex {
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [currencyIn, 1n << 255n, false],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [currencyOut, to, 0n], // OPEN_DELTA is 0
  );
  const input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [`0x${swapAction.toString(16).padStart(2, "0")}0b0e`, [swapParams, settle, take]],
  );

  return call("function execute(bytes, bytes[])", "execute", ["0x10", [input]]);
}

const POOL_KEY_ABI = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const CASES: Record<string, Case> = {
  uniswapV3ExactInput: {
    action: {
      type: "uniswapV3ExactInput",
      chainId: 1,
      router: TARGET,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      fee: 500,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
          "exactInputSingle",
          [[TOKEN, TOKEN_OUT, 500, RECIPIENT, AMOUNT, MIN, 0n]],
        ),
      },
    ],
  },
  uniswapV3ExactInputMultiHop: {
    action: {
      type: "uniswapV3ExactInputMultiHop",
      chainId: 1,
      router: TARGET,
      path: `${TOKEN}0001f4${TOKEN_OUT.slice(2)}` as Hex,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function exactInput((bytes,address,uint256,uint256))", "exactInput", [
          [`${TOKEN}0001f4${TOKEN_OUT.slice(2)}`, RECIPIENT, AMOUNT, MIN],
        ]),
      },
    ],
  },
  uniswapV4ExactInput: {
    action: {
      type: "uniswapV4ExactInput",
      chainId: 1,
      router: TARGET,
      poolKey: V4_KEY,
      zeroForOne: true,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      { to: TOKEN, data: call("function transfer(address,uint256)", "transfer", [TARGET, AMOUNT]) },
      {
        to: TARGET,
        data: v4Execute(
          0x06,
          encodeAbiParameters(
            [
              {
                type: "tuple",
                components: [
                  { ...POOL_KEY_ABI, name: "poolKey" },
                  { name: "zeroForOne", type: "bool" },
                  { name: "amountIn", type: "uint128" },
                  { name: "amountOutMinimum", type: "uint128" },
                  { name: "hookData", type: "bytes" },
                ],
              },
            ],
            [
              {
                poolKey: V4_KEY,
                zeroForOne: true,
                amountIn: AMOUNT,
                amountOutMinimum: MIN,
                hookData: "0x",
              },
            ],
          ),
          TOKEN,
          TOKEN_OUT,
          RECIPIENT,
        ),
      },
    ],
  },
  uniswapV4ExactInputMultiHop: {
    action: {
      type: "uniswapV4ExactInputMultiHop",
      chainId: 1,
      router: TARGET,
      currencyIn: TOKEN,
      path: [{ intermediateCurrency: TOKEN_OUT, fee: 500, tickSpacing: 10, hooks: ZERO }],
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      { to: TOKEN, data: call("function transfer(address,uint256)", "transfer", [TARGET, AMOUNT]) },
      {
        to: TARGET,
        data: v4Execute(
          0x07,
          encodeAbiParameters(
            [
              {
                type: "tuple",
                components: [
                  { name: "currencyIn", type: "address" },
                  {
                    name: "path",
                    type: "tuple[]",
                    components: [
                      { name: "intermediateCurrency", type: "address" },
                      { name: "fee", type: "uint24" },
                      { name: "tickSpacing", type: "int24" },
                      { name: "hooks", type: "address" },
                      { name: "hookData", type: "bytes" },
                    ],
                  },
                  { name: "amountIn", type: "uint128" },
                  { name: "amountOutMinimum", type: "uint128" },
                ],
              },
            ],
            [
              {
                currencyIn: TOKEN,
                path: [
                  {
                    intermediateCurrency: TOKEN_OUT,
                    fee: 500,
                    tickSpacing: 10,
                    hooks: ZERO,
                    hookData: "0x",
                  },
                ],
                amountIn: AMOUNT,
                amountOutMinimum: MIN,
              },
            ],
          ),
          TOKEN,
          TOKEN_OUT,
          RECIPIENT,
        ),
      },
    ],
  },
  curveSwap: {
    action: {
      type: "curveSwap",
      chainId: 1,
      pool: TARGET,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      i: 1,
      j: 2,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    // Unrecorded balance reads bracket the swap (both answer 42, so the delta is 0), then the delta
    // is forwarded to the recipient.
    expect: () => [
      {
        to: TARGET,
        data: call("function exchange(int128,int128,uint256,uint256)", "exchange", [
          1n,
          2n,
          AMOUNT,
          MIN,
        ]),
      },
      {
        to: TOKEN_OUT,
        data: call("function transfer(address,uint256)", "transfer", [RECIPIENT, 0n]),
      },
    ],
  },
  curveRouterNGSwap: {
    action: {
      type: "curveRouterNGSwap",
      chainId: 1,
      router: TARGET,
      route: [TOKEN, TARGET, TOKEN_OUT],
      swapParams: [[1, 2, 1, 1, 3]],
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      pools: [],
      recipient: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)",
          "exchange",
          [
            [TOKEN, TARGET, TOKEN_OUT, ...Array(8).fill(ZERO)],
            [[1n, 2n, 1n, 1n, 3n], ...Array.from({ length: 4 }, () => [0n, 0n, 0n, 0n, 0n])],
            AMOUNT,
            MIN,
            Array(5).fill(ZERO),
            RECIPIENT,
          ],
        ),
      },
    ],
  },
  balancerV2Swap: {
    action: {
      type: "balancerV2Swap",
      chainId: 1,
      vault: TARGET,
      poolId: "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019",
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: (pot) => [
      {
        to: TARGET,
        data: call(
          "function swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
          "swap",
          [
            [
              "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019",
              0,
              TOKEN,
              TOKEN_OUT,
              AMOUNT,
              "0x",
            ],
            [pot, false, RECIPIENT, false],
            MIN,
            BigInt(DEADLINE),
          ],
        ),
      },
    ],
  },
  balancerV2BatchSwap: {
    action: {
      type: "balancerV2BatchSwap",
      chainId: 1,
      vault: TARGET,
      steps: [
        { poolId: `0x${"11".repeat(32)}`, assetInIndex: 0, assetOutIndex: 1, amount: `${AMOUNT}` },
        { poolId: `0x${"22".repeat(32)}`, assetInIndex: 1, assetOutIndex: 2, amount: "0" },
      ],
      assets: [TOKEN, TARGET, TOKEN_OUT],
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: (pot) => [
      {
        to: TARGET,
        data: call(
          "function batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)",
          "batchSwap",
          [
            0,
            [
              [`0x${"11".repeat(32)}`, 0n, 1n, AMOUNT, "0x"],
              [`0x${"22".repeat(32)}`, 1n, 2n, 0n, "0x"],
            ],
            [TOKEN, TARGET, TOKEN_OUT],
            [pot, false, RECIPIENT, false],
            [MAX_INT256, MAX_INT256, -MIN],
            BigInt(DEADLINE),
          ],
        ),
      },
    ],
  },
  balancerV3Swap: {
    action: {
      type: "balancerV3Swap",
      chainId: 1,
      router: TARGET,
      pool: TOKEN,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      deadline: DEADLINE,
      wethIsEth: false,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)",
          "swapSingleTokenExactIn",
          [TOKEN, TOKEN, TOKEN_OUT, AMOUNT, MIN, BigInt(DEADLINE), false, "0x"],
        ),
      },
    ],
  },
  uniswapV2Swap: {
    action: {
      type: "uniswapV2Swap",
      chainId: 1,
      router: TARGET,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      path: [TOKEN, TOKEN_OUT],
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
          "swapExactTokensForTokens",
          [AMOUNT, MIN, [TOKEN, TOKEN_OUT], RECIPIENT, BigInt(DEADLINE)],
        ),
      },
    ],
  },
  ambientSwap: {
    action: {
      type: "ambientSwap",
      chainId: 1,
      dex: TARGET,
      base: TOKEN,
      quote: TOKEN_OUT,
      poolIdx: 420,
      isBuy: true,
      inBaseQty: true,
      amountIn: `${AMOUNT}`,
      tip: 0,
      limitPrice: "21267430153580247136652501917186561137",
      minOut: `${MIN}`,
      reserveFlags: 0,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function userCmd(uint16,bytes)", "userCmd", [
          1,
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
              { type: "uint128" },
              { type: "uint8" },
            ],
            [
              TOKEN,
              TOKEN_OUT,
              420n,
              true,
              true,
              AMOUNT,
              0,
              21267430153580247136652501917186561137n,
              MIN,
              0,
            ],
          ),
        ]),
      },
    ],
  },
  dodoSwap: {
    action: {
      type: "dodoSwap",
      chainId: 1,
      proxy: TARGET,
      fromToken: TOKEN,
      toToken: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      dodoPairs: [TOKEN],
      directions: 1,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)",
          "dodoSwapV2TokenToToken",
          [TOKEN, TOKEN_OUT, AMOUNT, MIN, [TOKEN], 1n, false, BigInt(DEADLINE)],
        ),
      },
    ],
  },
  dodoSwapV1: {
    action: {
      type: "dodoSwap",
      chainId: 1,
      proxy: TARGET,
      fromToken: TOKEN,
      toToken: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      dodoPairs: [TOKEN],
      directions: 0,
      deadline: DEADLINE,
      version: "v1",
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)",
          "dodoSwapV1",
          [TOKEN, TOKEN_OUT, AMOUNT, MIN, [TOKEN], 0n, false, BigInt(DEADLINE)],
        ),
      },
    ],
  },
  maverickSwap: {
    action: {
      type: "maverickSwap",
      chainId: 1,
      router: TARGET,
      pool: TOKEN,
      tokenAIn: true,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function exactInputSingle(address,address,bool,uint256,uint256)",
          "exactInputSingle",
          [RECIPIENT, TOKEN, true, AMOUNT, MIN],
        ),
      },
    ],
  },
  maverickMultiHopSwap: {
    action: {
      type: "maverickMultiHopSwap",
      chainId: 1,
      router: TARGET,
      path: "0xabcdef",
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function exactInputMultiHop(address,bytes,uint256,uint256)",
          "exactInputMultiHop",
          [RECIPIENT, "0xabcdef", AMOUNT, MIN],
        ),
      },
    ],
  },
  carbonSwap: {
    action: {
      type: "carbonSwap",
      chainId: 1,
      controller: TARGET,
      sourceToken: TOKEN,
      targetToken: TOKEN_OUT,
      tradeActions: [{ strategyId: "123", amount: `${AMOUNT}` }],
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)",
          "tradeBySourceAmount",
          [TOKEN, TOKEN_OUT, [[123n, AMOUNT]], BigInt(DEADLINE), MIN],
        ),
      },
    ],
  },
  fraxswapSwap: {
    action: {
      type: "fraxswapSwap",
      chainId: 1,
      router: TARGET,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      path: [TOKEN, TOKEN_OUT],
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
          "swapExactTokensForTokens",
          [AMOUNT, MIN, [TOKEN, TOKEN_OUT], RECIPIENT, BigInt(DEADLINE)],
        ),
      },
    ],
  },
  clipperSwap: {
    action: {
      type: "clipperSwap",
      chainId: 1,
      exchange: TARGET,
      inputToken: TOKEN,
      outputToken: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
      auxiliaryData: "0xdead",
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function sellTokenForToken(address,address,address,uint256,bytes)",
          "sellTokenForToken",
          [TOKEN, TOKEN_OUT, RECIPIENT, MIN, "0xdead"],
        ),
      },
    ],
  },
  integralSwap: {
    action: {
      type: "integralSwap",
      chainId: 1,
      delay: TARGET,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      wrapUnwrap: false,
      recipient: RECIPIENT,
      gasLimit: "400000",
      submitDeadline: 1_700_000_000,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function sell((address,address,uint256,uint256,bool,address,uint256,uint32))",
          "sell",
          [[TOKEN, TOKEN_OUT, AMOUNT, MIN, false, RECIPIENT, 400000n, 1_700_000_000]],
        ),
      },
    ],
  },
  fluidDexT1Swap: {
    action: {
      type: "fluidDexT1Swap",
      chainId: 1,
      pool: TARGET,
      swap0to1: true,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function swapIn(bool,uint256,uint256,address)", "swapIn", [
          true,
          AMOUNT,
          MIN,
          RECIPIENT,
        ]),
      },
    ],
  },
  fluidDexLiteSwap: {
    action: {
      type: "fluidDexLiteSwap",
      chainId: 1,
      dex: TARGET,
      token0: TOKEN,
      token1: TOKEN_OUT,
      salt: `0x${"00".repeat(32)}`,
      swap0To1: true,
      amountIn: `${AMOUNT}`,
      amountOutMin: `${MIN}`,
      recipient: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call(
          "function swapSingle((address,address,bytes32),bool,int256,uint256,address)",
          "swapSingle",
          [[TOKEN, TOKEN_OUT, `0x${"00".repeat(32)}`], true, AMOUNT, MIN, RECIPIENT],
        ),
      },
    ],
  },
  transfer: {
    action: { type: "transfer", chainId: 1, token: TOKEN, to: RECIPIENT, amount: `${AMOUNT}` },
    expect: () => [
      {
        to: TOKEN,
        data: call("function transfer(address,uint256)", "transfer", [RECIPIENT, AMOUNT]),
      },
    ],
  },
  approve: {
    action: { type: "approve", chainId: 1, token: TOKEN, spender: TARGET, amount: `${AMOUNT}` },
    expect: () => [
      { to: TOKEN, data: call("function approve(address,uint256)", "approve", [TARGET, AMOUNT]) },
    ],
  },
  wrapETH: {
    action: { type: "wrapETH", chainId: 1, weth: TARGET, amount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  },
  unwrapETH: {
    action: { type: "unwrapETH", chainId: 1, weth: TARGET, amount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: call("function withdraw(uint256)", "withdraw", [AMOUNT]) }],
  },
  wrapStETH: {
    action: { type: "wrapStETH", chainId: 1, wstETH: TARGET, stETHAmount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: call("function wrap(uint256)", "wrap", [AMOUNT]) }],
  },
  unwrapStETH: {
    action: { type: "unwrapStETH", chainId: 1, wstETH: TARGET, wstETHAmount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: call("function unwrap(uint256)", "unwrap", [AMOUNT]) }],
  },
  lidoStake: {
    action: {
      type: "lidoStake",
      chainId: 1,
      stETH: TARGET,
      amount: `${AMOUNT}`,
      referral: RECIPIENT,
    },
    expect: () => [
      { to: TARGET, data: call("function submit(address)", "submit", [RECIPIENT]), value: AMOUNT },
    ],
  },
  lidoUnstake: {
    action: { type: "lidoUnstake", chainId: 1, withdrawalQueue: TARGET, stETHAmount: `${AMOUNT}` },
    // The owner is the Pot's caller (`ctx.msgSender()`), which is the account sending the cook.
    expect: () => [],
  },
  rocketPoolStake: {
    action: {
      type: "rocketPoolStake",
      chainId: 1,
      rETH: TOKEN,
      depositPool: TARGET,
      amount: `${AMOUNT}`,
    },
    expect: () => [{ to: TARGET, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  },
  rocketPoolUnstake: {
    action: { type: "rocketPoolUnstake", chainId: 1, rETH: TARGET, amount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: call("function burn(uint256)", "burn", [AMOUNT]) }],
  },
  etherFiStake: {
    action: { type: "etherFiStake", chainId: 1, liquidityPool: TARGET, amount: `${AMOUNT}` },
    expect: () => [{ to: TARGET, data: toFunctionSelector("deposit()"), value: AMOUNT }],
  },
  aaveV3Supply: {
    action: {
      type: "aaveV3Supply",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
      onBehalfOf: RECIPIENT,
      referralCode: 7,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function supply(address,uint256,address,uint16)", "supply", [
          TOKEN,
          AMOUNT,
          RECIPIENT,
          7,
        ]),
      },
    ],
  },
  aaveV3Withdraw: {
    action: {
      type: "aaveV3Withdraw",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
      to: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function withdraw(address,uint256,address)", "withdraw", [
          TOKEN,
          AMOUNT,
          RECIPIENT,
        ]),
      },
    ],
  },
  aaveV3Borrow: {
    action: {
      type: "aaveV3Borrow",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
      interestRateMode: 2,
      onBehalfOf: RECIPIENT,
      referralCode: 0,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function borrow(address,uint256,uint256,uint16,address)", "borrow", [
          TOKEN,
          AMOUNT,
          2n,
          0,
          RECIPIENT,
        ]),
      },
    ],
  },
  aaveV3Repay: {
    action: {
      type: "aaveV3Repay",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
      interestRateMode: 2,
      onBehalfOf: RECIPIENT,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function repay(address,uint256,uint256,address)", "repay", [
          TOKEN,
          AMOUNT,
          2n,
          RECIPIENT,
        ]),
      },
    ],
  },
  compoundV3Supply: {
    action: {
      type: "compoundV3Supply",
      chainId: 1,
      comet: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
    },
    expect: () => [
      { to: TARGET, data: call("function supply(address,uint256)", "supply", [TOKEN, AMOUNT]) },
    ],
  },
  compoundV3Withdraw: {
    action: {
      type: "compoundV3Withdraw",
      chainId: 1,
      comet: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
    },
    expect: () => [
      { to: TARGET, data: call("function withdraw(address,uint256)", "withdraw", [TOKEN, AMOUNT]) },
    ],
  },
  cctpBridge: {
    action: {
      type: "cctpBridge",
      srcChainId: 1,
      destChainId: 10,
      tokenMessenger: TARGET,
      token: TOKEN,
      srcDomain: 0,
      destDomain: 2,
      amount: `${AMOUNT}`,
      mintRecipient: `0x000000000000000000000000${RECIPIENT.slice(2)}`,
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function depositForBurn(uint256,uint32,bytes32,address)", "depositForBurn", [
          AMOUNT,
          2,
          `0x000000000000000000000000${RECIPIENT.slice(2)}`,
          TOKEN,
        ]),
      },
    ],
  },
  hyperlaneBridge: {
    action: {
      type: "hyperlaneBridge",
      srcChainId: 1,
      destChainId: 10,
      router: TARGET,
      token: TOKEN,
      amount: `${AMOUNT}`,
      destinationDomain: 10,
      gasPayment: "9",
    },
    expect: () => [
      {
        to: TARGET,
        data: call("function dispatch(uint32,bytes32,bytes)", "dispatch", [10, pad(TOKEN), "0x"]),
        value: 9n,
      },
    ],
  },
};

/** Cases whose calls name the Pot's CALLER (`ctx.msgSender()`), checked separately below. */
const CALLER_CASES = ["acrossBridge", "stargateBridge", "lidoUnstake"];

const skip = skipReason();

describe("every action's calldata, executed", { skip, timeout: 120_000 }, () => {
  let env: Anvil;

  before(async () => {
    env = await startAnvil();
    for (const recorder of RECORDERS) {
      await env.testClient.setCode({ address: recorder, bytecode: recorderCode(WORD) });
    }
    await env.testClient.setBalance({ address: env.pot, value: 10n ** 20n });
  });

  after(() => env?.stop());

  for (const [name, { action, expect }] of Object.entries(CASES)) {
    if (CALLER_CASES.includes(name)) continue;
    it(`${name} makes exactly the intended calls`, async () => {
      const receipt = await env.cook(actionsToSauce([action]));
      assert.equal(receipt.status, "success", `${name}: the program reverted`);
      const calls = recordedCalls(receipt, RECORDERS);
      const expected = expect(env.pot);
      assert.equal(
        calls.length,
        expected.length,
        `${name}: ${calls.length} calls, expected ${expected.length}`,
      );
      expected.forEach((want, i) => {
        assert.equal(
          calls[i]!.to.toLowerCase(),
          want.to.toLowerCase(),
          `${name}: call ${i} target`,
        );
        assert.equal(calls[i]!.data, want.data.toLowerCase(), `${name}: call ${i} calldata`);
        assert.equal(calls[i]!.value, want.value ?? 0n, `${name}: call ${i} value`);
      });
    });
  }

  it("calls naming the Pot's caller use the account that sent the cook", async () => {
    const caller = env.account.address;
    const across = await env.cook(
      actionsToSauce([
        {
          type: "acrossBridge",
          srcChainId: 1,
          destChainId: 10,
          spokePool: TARGET,
          token: TOKEN,
          amount: `${AMOUNT}`,
          relayerFeePct: "0",
          quoteTimestamp: 1,
          fillDeadline: 2,
          exclusivityDeadline: 0,
          message: "0x",
        },
      ]),
    );
    assert.equal(
      recordedCalls(across, [TARGET])[0]!.data,
      call(
        "function depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
        "depositV3",
        [caller, caller, TOKEN, TOKEN, AMOUNT, AMOUNT, 10n, ZERO, 1, 2, 0, "0x"],
      ).toLowerCase(),
    );

    // Stargate V1's real `swap`: the LayerZero fee rides as value, and `to` is the caller's 20
    // packed bytes. The previous `(address,address,bytes)` signature is not on the V1 router.
    const stargate = await env.cook(
      actionsToSauce([
        {
          type: "stargateBridge",
          srcChainId: 1,
          destChainId: 110,
          router: TARGET,
          token: TOKEN,
          srcPoolId: 1,
          dstPoolId: 1,
          amount: `${AMOUNT}`,
          amountOutMin: `${MIN}`,
          lzFee: "7",
        },
      ]),
    );
    const sg = recordedCalls(stargate, [TARGET])[0]!;
    assert.equal(sg.value, 7n);
    assert.equal(
      sg.data,
      call(
        "function swap(uint16,uint256,uint256,address,uint256,uint256,(uint256,uint256,bytes),bytes,bytes)",
        "swap",
        [110, 1n, 1n, caller, AMOUNT, MIN, [0n, 0n, "0x"], caller.toLowerCase(), "0x"],
      ).toLowerCase(),
    );

    const lido = await env.cook(
      actionsToSauce([
        { type: "lidoUnstake", chainId: 1, withdrawalQueue: TARGET, stETHAmount: `${AMOUNT}` },
      ]),
    );
    assert.equal(
      recordedCalls(lido, [TARGET])[0]!.data,
      call("function requestWithdrawals(uint256[],address)", "requestWithdrawals", [
        [AMOUNT],
        caller,
      ]).toLowerCase(),
    );
  });

  it("a chained output is delivered to the Pot, and read as a balance delta where the return is not an amount", async () => {
    const chained = (name: string): RoutingAction =>
      ({ ...CASES[name]!.action, saveOutputAs: "out" }) as RoutingAction;

    // A captured return: the router pays the Pot, and nothing else is called.
    const v3 = recordedCalls(
      await env.cook(actionsToSauce([chained("uniswapV3ExactInput")])),
      RECORDERS,
    );
    assert.equal(v3.length, 1);
    assert.equal(
      v3[0]!.data,
      call(
        "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        "exactInputSingle",
        [[TOKEN, TOKEN_OUT, 500, env.pot, AMOUNT, MIN, 0n]],
      ).toLowerCase(),
    );

    // A balance delta: the swap pays the Pot, between two (unrecorded) balance reads.
    const v2 = recordedCalls(await env.cook(actionsToSauce([chained("uniswapV2Swap")])), RECORDERS);
    assert.equal(v2.length, 1);
    assert.equal(
      v2[0]!.data,
      call(
        "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
        "swapExactTokensForTokens",
        [AMOUNT, MIN, [TOKEN, TOKEN_OUT], env.pot, BigInt(DEADLINE)],
      ).toLowerCase(),
    );

    // V4 now routes a chained output to the Pot too: the TAKE recipient is the Pot.
    const v4 = recordedCalls(
      await env.cook(actionsToSauce([chained("uniswapV4ExactInput")])),
      RECORDERS,
    );
    assert.equal(v4.length, 2); // transfer, execute
    assert.ok(
      v4[1]!.data.includes(env.pot.slice(2).toLowerCase()),
      "the V4 TAKE should pay the Pot when the output is chained",
    );
  });

  it('a "self" recipient is the Pot', async () => {
    const receipt = await env.cook(
      actionsToSauce([{ type: "transfer", chainId: 1, token: TOKEN, to: "self", amount: "5" }]),
    );
    assert.equal(
      recordedCalls(receipt, [TOKEN])[0]!.data,
      call("function transfer(address,uint256)", "transfer", [env.pot, 5n]).toLowerCase(),
    );
  });
});
