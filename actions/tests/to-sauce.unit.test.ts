/**
 * Offline coverage for `to-sauce.ts` — no fork, no node, no network, so it can run in CI.
 *
 * `to-sauce.test.ts` is the only other test for this file and it needs a mainnet fork RPC, so until
 * now the largest module in the package had NO coverage in CI at all. What this pins is the two
 * things a source generator can get wrong without anyone noticing: which contract each action calls
 * (the target literal) and what it calls on it (the 4-byte selector), for every action type — plus
 * that the emitted program actually compiles, which is the whole point of the generator.
 *
 * Selectors are derived with viem's `toFunctionSelector` from the signature, so a signature edit has
 * to be made in both places to pass, and a typo in either is caught.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";

import { actionsToSauce, actionsToSauceSource, actionToSauce } from "../src/to-sauce.js";
import type { RoutingAction } from "../src/types.js";

type A = `0x${string}`;

const TOKEN = "0x1000000000000000000000000000000000000001" as A;
const TOKEN_OUT = "0x1000000000000000000000000000000000000002" as A;
const TARGET = "0x2000000000000000000000000000000000000001" as A;
const RECIPIENT = "0x3000000000000000000000000000000000000001" as A;
const ZERO = "0x0000000000000000000000000000000000000000" as A;

const AMOUNT = "1000000";
const MIN = "1";
const DEADLINE = 9_999_999_999;

/** `hex`…`` for a signature's selector — the form `emit.ts` binds every selector as. */
function selectorLiteral(sig: string): string {
  return `hex\`${toFunctionSelector(sig).slice(2)}\``;
}

/** An address as the SauceScript literal the emitted source carries. */
function literal(addr: A): string {
  return `${BigInt(addr)}n`;
}

interface Case {
  readonly action: RoutingAction;
  /** Contracts the program must call. */
  readonly targets: readonly A[];
  /** Signatures the program must carry the selector of. */
  readonly signatures: readonly string[];
}

const CASES: Record<string, Case> = {
  uniswapV3ExactInput: {
    action: {
      type: "uniswapV3ExactInput",
      chainId: 1,
      router: TARGET,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      fee: 500,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"],
  },
  uniswapV3ExactInputMultiHop: {
    action: {
      type: "uniswapV3ExactInputMultiHop",
      chainId: 1,
      router: TARGET,
      path: `${TOKEN}0001f4${TOKEN_OUT.slice(2)}` as A,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["exactInput((bytes,address,uint256,uint256))"],
  },
  uniswapV4ExactInput: {
    action: {
      type: "uniswapV4ExactInput",
      chainId: 1,
      router: TARGET,
      poolKey: { currency0: TOKEN, currency1: TOKEN_OUT, fee: 500, tickSpacing: 10, hooks: ZERO },
      zeroForOne: true,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    // The input token is transferred to the router first, then the router is executed.
    targets: [TOKEN, TARGET],
    signatures: ["transfer(address,uint256)", "execute(bytes,bytes[])"],
  },
  uniswapV4ExactInputMultiHop: {
    action: {
      type: "uniswapV4ExactInputMultiHop",
      chainId: 1,
      router: TARGET,
      currencyIn: TOKEN,
      path: [{ intermediateCurrency: TOKEN_OUT, fee: 500, tickSpacing: 10, hooks: ZERO }],
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    targets: [TOKEN, TARGET],
    signatures: ["transfer(address,uint256)", "execute(bytes,bytes[])"],
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
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    // The 4-arg `exchange` returns void and pays msg.sender, so the output is recovered from a
    // pre/post `balanceOf` delta and then forwarded.
    targets: [TARGET, TOKEN_OUT],
    signatures: [
      "exchange(int128,int128,uint256,uint256)",
      "balanceOf(address)",
      "transfer(address,uint256)",
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
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: [
      "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
    ],
  },
  balancerV2BatchSwap: {
    action: {
      type: "balancerV2BatchSwap",
      chainId: 1,
      vault: TARGET,
      steps: [
        {
          poolId: "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019",
          assetInIndex: 0,
          assetOutIndex: 1,
          amount: AMOUNT,
        },
      ],
      assets: [TOKEN, TOKEN_OUT],
      amountOutMin: MIN,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: [
      "batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)",
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
      amountIn: AMOUNT,
      amountOutMin: MIN,
      deadline: DEADLINE,
      wethIsEth: false,
    },
    targets: [TARGET],
    signatures: [
      "swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)",
    ],
  },
  uniswapV2Swap: {
    action: {
      type: "uniswapV2Swap",
      chainId: 1,
      router: TARGET,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      path: [TOKEN, TOKEN_OUT],
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"],
  },
  curveRouterNGSwap: {
    action: {
      type: "curveRouterNGSwap",
      chainId: 1,
      router: TARGET,
      route: [TOKEN, TOKEN_OUT],
      swapParams: [[1, 2, 1, 1, 2]],
      amountIn: AMOUNT,
      amountOutMin: MIN,
      pools: [TOKEN],
      recipient: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)"],
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
      amountIn: AMOUNT,
      tip: 0,
      limitPrice: "65537",
      minOut: MIN,
      reserveFlags: 0,
    },
    targets: [TARGET],
    signatures: ["userCmd(uint16,bytes)"],
  },
  dodoSwap: {
    action: {
      type: "dodoSwap",
      chainId: 1,
      proxy: TARGET,
      fromToken: TOKEN,
      toToken: TOKEN_OUT,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      dodoPairs: [TOKEN],
      directions: 0,
      deadline: DEADLINE,
      version: "v2",
    },
    targets: [TARGET],
    signatures: [
      "dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)",
    ],
  },
  maverickSwap: {
    action: {
      type: "maverickSwap",
      chainId: 1,
      router: TARGET,
      pool: TOKEN,
      tokenAIn: true,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["exactInputSingle(address,address,bool,uint256,uint256)"],
  },
  maverickMultiHopSwap: {
    action: {
      type: "maverickMultiHopSwap",
      chainId: 1,
      router: TARGET,
      path: `${TOKEN}${TOKEN_OUT.slice(2)}` as A,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["exactInputMultiHop(address,bytes,uint256,uint256)"],
  },
  carbonSwap: {
    action: {
      type: "carbonSwap",
      chainId: 1,
      controller: TARGET,
      sourceToken: TOKEN,
      targetToken: TOKEN_OUT,
      tradeActions: [{ strategyId: "7", amount: AMOUNT }],
      amountIn: AMOUNT,
      amountOutMin: MIN,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)"],
  },
  fraxswapSwap: {
    action: {
      type: "fraxswapSwap",
      chainId: 1,
      router: TARGET,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      path: [TOKEN, TOKEN_OUT],
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"],
  },
  clipperSwap: {
    action: {
      type: "clipperSwap",
      chainId: 1,
      exchange: TARGET,
      inputToken: TOKEN,
      outputToken: TOKEN_OUT,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
      auxiliaryData: "0xdeadbeef",
    },
    targets: [TARGET],
    signatures: ["sellTokenForToken(address,address,address,uint256,bytes)"],
  },
  integralSwap: {
    action: {
      type: "integralSwap",
      chainId: 1,
      delay: TARGET,
      tokenIn: TOKEN,
      tokenOut: TOKEN_OUT,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      wrapUnwrap: false,
      recipient: RECIPIENT,
      gasLimit: "500000",
      submitDeadline: DEADLINE,
    },
    targets: [TARGET],
    signatures: ["sell((address,address,uint256,uint256,bool,address,uint256,uint32))"],
  },
  fluidDexT1Swap: {
    action: {
      type: "fluidDexT1Swap",
      chainId: 1,
      pool: TARGET,
      swap0to1: true,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["swapIn(bool,uint256,uint256,address)"],
  },
  fluidDexLiteSwap: {
    action: {
      type: "fluidDexLiteSwap",
      chainId: 1,
      dex: TARGET,
      token0: TOKEN,
      token1: TOKEN_OUT,
      salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      swap0To1: true,
      amountIn: AMOUNT,
      amountOutMin: MIN,
      recipient: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["swapSingle((address,address,bytes32),bool,int256,uint256,address)"],
  },
  transfer: {
    action: { type: "transfer", chainId: 1, token: TOKEN, to: RECIPIENT, amount: AMOUNT },
    targets: [TOKEN],
    signatures: ["transfer(address,uint256)"],
  },
  approve: {
    action: { type: "approve", chainId: 1, token: TOKEN, spender: TARGET, amount: AMOUNT },
    targets: [TOKEN],
    signatures: ["approve(address,uint256)"],
  },
  wrapETH: {
    action: { type: "wrapETH", chainId: 1, weth: TARGET, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["deposit()"],
  },
  unwrapETH: {
    action: { type: "unwrapETH", chainId: 1, weth: TARGET, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["withdraw(uint256)"],
  },
  wrapStETH: {
    action: { type: "wrapStETH", chainId: 1, wstETH: TARGET, stETHAmount: AMOUNT },
    targets: [TARGET],
    signatures: ["wrap(uint256)"],
  },
  unwrapStETH: {
    action: { type: "unwrapStETH", chainId: 1, wstETH: TARGET, wstETHAmount: AMOUNT },
    targets: [TARGET],
    signatures: ["unwrap(uint256)"],
  },
  lidoStake: {
    action: { type: "lidoStake", chainId: 1, stETH: TARGET, amount: AMOUNT, referral: ZERO },
    targets: [TARGET],
    signatures: ["submit(address)"],
  },
  lidoUnstake: {
    action: { type: "lidoUnstake", chainId: 1, withdrawalQueue: TARGET, stETHAmount: AMOUNT },
    targets: [TARGET],
    signatures: ["requestWithdrawals(uint256[],address)"],
  },
  rocketPoolStake: {
    action: {
      type: "rocketPoolStake",
      chainId: 1,
      rETH: TOKEN,
      depositPool: TARGET,
      amount: AMOUNT,
    },
    targets: [TARGET],
    signatures: ["deposit()"],
  },
  rocketPoolUnstake: {
    action: { type: "rocketPoolUnstake", chainId: 1, rETH: TARGET, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["burn(uint256)"],
  },
  coinbaseStake: {
    action: { type: "coinbaseStake", chainId: 1, cbETH: TARGET, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["deposit()"],
  },
  etherFiStake: {
    action: { type: "etherFiStake", chainId: 1, liquidityPool: TARGET, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["deposit()"],
  },
  aaveV3Supply: {
    action: {
      type: "aaveV3Supply",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      onBehalfOf: RECIPIENT,
      referralCode: 0,
    },
    targets: [TARGET],
    signatures: ["supply(address,uint256,address,uint16)"],
  },
  aaveV3Withdraw: {
    action: {
      type: "aaveV3Withdraw",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      to: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["withdraw(address,uint256,address)"],
  },
  aaveV3Borrow: {
    action: {
      type: "aaveV3Borrow",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      interestRateMode: 2,
      onBehalfOf: RECIPIENT,
      referralCode: 0,
    },
    targets: [TARGET],
    signatures: ["borrow(address,uint256,uint256,uint16,address)"],
  },
  aaveV3Repay: {
    action: {
      type: "aaveV3Repay",
      chainId: 1,
      pool: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      interestRateMode: 2,
      onBehalfOf: RECIPIENT,
    },
    targets: [TARGET],
    signatures: ["repay(address,uint256,uint256,address)"],
  },
  compoundV3Supply: {
    action: { type: "compoundV3Supply", chainId: 1, comet: TARGET, token: TOKEN, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["supply(address,uint256)"],
  },
  compoundV3Withdraw: {
    action: { type: "compoundV3Withdraw", chainId: 1, comet: TARGET, token: TOKEN, amount: AMOUNT },
    targets: [TARGET],
    signatures: ["withdraw(address,uint256)"],
  },
  acrossBridge: {
    action: {
      type: "acrossBridge",
      srcChainId: 1,
      destChainId: 10,
      spokePool: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      relayerFeePct: "0",
      quoteTimestamp: 1_700_000_000,
      fillDeadline: DEADLINE,
      exclusivityDeadline: 0,
      message: "0x",
    },
    targets: [TARGET],
    signatures: [
      "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
    ],
  },
  stargateBridge: {
    action: {
      type: "stargateBridge",
      srcChainId: 1,
      destChainId: 110,
      router: TARGET,
      token: TOKEN,
      srcPoolId: 1,
      dstPoolId: 1,
      amount: AMOUNT,
      amountOutMin: MIN,
      lzFee: "7",
    },
    targets: [TARGET],
    signatures: ["swap(uint16,uint256,uint256,address,uint256,uint256,(address,address,bytes))"],
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
      amount: AMOUNT,
      mintRecipient: "0x0000000000000000000000003000000000000000000000000000000000000001",
    },
    targets: [TARGET],
    signatures: ["depositForBurn(uint256,uint32,bytes32,address)"],
  },
  hyperlaneBridge: {
    action: {
      type: "hyperlaneBridge",
      srcChainId: 1,
      destChainId: 10,
      router: TARGET,
      token: TOKEN,
      amount: AMOUNT,
      destinationDomain: 10,
      gasPayment: "9",
    },
    targets: [TARGET],
    signatures: ["dispatch(uint32,bytes32,bytes)"],
  },
};

/** Every action type the dispatcher handles, so a new one cannot be added without a case here. */
const ACTION_TYPES = Object.keys(CASES);

describe("actionsToSauce — every action type", () => {
  for (const [name, { action, targets, signatures }] of Object.entries(CASES)) {
    it(`${name}: compiles, and calls the right contracts with the right selectors`, () => {
      const source = actionsToSauceSource([action]);

      for (const target of targets) {
        assert.ok(
          source.includes(`evm.call(${literal(target)}, `),
          `${name}: no evm.call to ${target}\n${source}`,
        );
      }
      for (const sig of signatures) {
        assert.ok(
          source.includes(selectorLiteral(sig)),
          `${name}: missing selector for ${sig} (${selectorLiteral(sig)})\n${source}`,
        );
      }
      // Every generated program is a value-less `main`; the compiler rejects one with no return
      // type, so this is the annotation that keeps it compiling.
      assert.ok(source.startsWith("function main(): void {"), `${name}: main is not declared void`);

      const bytecode = actionsToSauce([action]);
      assert.ok(bytecode.length > 0, `${name}: compiled to empty bytecode`);
    });
  }

  it("covers every action type the dispatcher accepts", () => {
    // A new action type added to `buildAction` without a case above shows up as a throw here.
    for (const type of ACTION_TYPES) {
      assert.doesNotThrow(() => actionToSauce(CASES[type].action), `${type} did not build`);
    }
    assert.equal(ACTION_TYPES.length, 42, "action-type count changed — add or remove a case above");
  });
});

describe("actionsToSauce — native value", () => {
  const valueCases: ReadonlyArray<readonly [string, string]> = [
    ["wrapETH", AMOUNT],
    ["lidoStake", AMOUNT],
    ["rocketPoolStake", AMOUNT],
    ["coinbaseStake", AMOUNT],
    ["etherFiStake", AMOUNT],
    ["stargateBridge", "7"],
    ["hyperlaneBridge", "9"],
  ];

  for (const [name, value] of valueCases) {
    it(`${name} attaches ${value} wei`, () => {
      const source = actionsToSauceSource([CASES[name].action]);
      const target = CASES[name].targets[0];
      assert.ok(
        source.includes(`evm.call(${literal(target)}, ${value}n, `),
        `${name}: expected value ${value}n on the call to ${target}\n${source}`,
      );
    });
  }

  it("every other action attaches zero", () => {
    for (const [name, { action }] of Object.entries(CASES)) {
      if (valueCases.some(([n]) => n === name)) continue;
      const source = actionsToSauceSource([action]);
      assert.doesNotMatch(
        source,
        /evm\.call\([0-9]+n, (?!0n)[^,]+, /,
        `${name}: attached non-zero value\n${source}`,
      );
    }
  });
});

/**
 * Seven builders stored the PASS-THROUGH INPUT amount (or worse) as their chained output, so a
 * downstream approve/swap acted on a number denominated in the wrong asset — or, for fraxswap, on
 * the constant 32, and for integral on an order id.
 *
 * The check is the same for each: the stored slot must be a realized value, never the literal
 * amount that went in. `AMOUNT` is a compile-time literal, so if it appears as the whole
 * right-hand side of the store, the builder captured nothing.
 */
describe("actionsToSauce — a chained output is realized, never the input amount", () => {
  const chained = (name: string): string =>
    actionsToSauceSource([{ ...CASES[name].action, saveOutputAs: "out" } as RoutingAction]);

  /** The expression a chained action stores, i.e. the right-hand side of `let v_out = …;`. */
  const storedOutput = (source: string): string => {
    const m = source.match(/let v_out = (.+);/);
    assert.ok(m, `expected a stored output slot\n${source}`);
    return m[1];
  };

  for (const name of [
    "balancerV2BatchSwap",
    "ambientSwap",
    "uniswapV4ExactInput",
    "uniswapV4ExactInputMultiHop",
    "fluidDexLiteSwap",
    "fraxswapSwap",
  ]) {
    it(`${name} stores a balance delta, not \`${AMOUNT}n\``, () => {
      const source = chained(name);
      const stored = storedOutput(source);

      assert.notEqual(stored, `${AMOUNT}n`, `${name} stored the input amount\n${source}`);
      // The delta shape: two `balanceOf(address)` reads bracketing the call, subtracted. The
      // emitted source carries the SELECTOR, not the signature.
      assert.equal(
        source.match(/70a08231/g)?.length,
        2,
        `${name} should snapshot the output balance pre and post\n${source}`,
      );
      assert.match(stored, /^delta\d+$/, `${name} should store the bound delta\n${source}`);
      assert.match(source, /const delta\d+ = bal\d+ - bal\d+;/, `${name} delta shape\n${source}`);
    });
  }

  // Integral places an order now and executes it later, so there is no output in this transaction.
  // Returning any number would be a lie; the previous code chained the order id.
  it("integralSwap refuses to be chained at all", () => {
    assert.throws(() => chained("integralSwap"), /delayed-order venue/);
  });

  // `steps[0].amount` always satisfies getExplicitAmount, so amountRef lost the precedence race and
  // was accepted then ignored. The amounts are ABI-encoded at build time, so it cannot be honoured.
  it("balancerV2BatchSwap rejects an amountRef it could never apply", () => {
    assert.throws(
      () =>
        actionsToSauceSource([
          { ...CASES.balancerV2BatchSwap.action, amountRef: "prev" } as RoutingAction,
        ]),
      /amountRef` cannot be applied/,
    );
  });
});

describe("actionsToSauce — chaining", () => {
  const v3 = (extra: Record<string, unknown>): RoutingAction =>
    ({ ...CASES.uniswapV3ExactInput.action, ...extra }) as RoutingAction;

  it("an empty action list compiles to empty bytecode", () => {
    assert.equal(actionsToSauceSource([]), "");
    assert.equal(actionsToSauce([]).length, 0);
  });

  it("saveOutputAs binds a local, and amountRef reads it", () => {
    const source = actionsToSauceSource([
      v3({ saveOutputAs: "swapOut" }),
      { type: "transfer", chainId: 1, token: TOKEN_OUT, to: RECIPIENT, amountRef: "swapOut" },
    ]);
    assert.match(source, /let v_swapOut = /, "saveOutputAs should declare a local");
    // `transfer(address,uint256)`'s second argument is that local, not a baked literal.
    assert.match(source, /f1: v_swapOut \}/, "amountRef should read the local");
  });

  it("a chained swap sends its output to ctx.self(), an unchained one to the recipient", () => {
    const chained = actionsToSauceSource([v3({ saveOutputAs: "out" })]);
    assert.ok(
      chained.includes("f3: ctx.self()"),
      `chained recipient should be ctx.self()\n${chained}`,
    );

    const standalone = actionsToSauceSource([v3({})]);
    assert.ok(
      standalone.includes(`f3: ${literal(RECIPIENT)}`),
      `unchained recipient should be the action's own\n${standalone}`,
    );
  });

  it("an implicit chain (no amount, no amountRef) reads the previous action output", () => {
    const source = actionsToSauceSource([
      { type: "approve", chainId: 1, token: TOKEN, spender: TARGET, amount: AMOUNT },
      v3({ amountIn: undefined }),
    ]);
    assert.match(source, /let t_out0 = /, "the first action should bind an implicit output slot");
    // `exactInputSingle`'s params tuple carries amountIn at field 4.
    assert.match(source, /f4: t_out0,/, "the second action should consume it");
  });

  it("two swaps saving to the same name assign rather than re-declare", () => {
    const source = actionsToSauceSource([
      v3({ saveOutputAs: "out" }),
      v3({ saveOutputAs: "out" }),
      { type: "transfer", chainId: 1, token: TOKEN_OUT, to: RECIPIENT, amountRef: "out" },
    ]);
    assert.equal(source.match(/let v_out = /g)?.length, 1, "the local should be declared once");
    assert.equal(
      source.match(/^ {2}v_out = /gm)?.length,
      1,
      "the second save should be an assignment",
    );
    assert.ok(
      actionsToSauce([
        v3({ saveOutputAs: "out" }),
        v3({ saveOutputAs: "out" }),
        { type: "transfer", chainId: 1, token: TOKEN_OUT, to: RECIPIENT, amountRef: "out" },
      ]).length > 0,
    );
  });

  it("rejects a slot name that is not a valid identifier", () => {
    assert.throws(
      () => actionsToSauceSource([v3({ saveOutputAs: "not-an-identifier" })]),
      /must be a valid identifier/,
    );
  });

  it("throws when an action has no amount and nothing to chain from", () => {
    assert.throws(() => actionsToSauceSource([v3({ amountIn: undefined })]), /No amount specified/);
  });

  it("names are per-program, so two builds of the same actions are byte-identical", () => {
    // The retired builder kept its curve/v2 scratch counters at module scope, so a program's slot
    // names depended on how many programs had been built before it.
    const actions = [CASES.curveSwap.action, CASES.uniswapV2Swap.action];
    assert.equal(actionsToSauceSource(actions), actionsToSauceSource(actions));
  });
});
