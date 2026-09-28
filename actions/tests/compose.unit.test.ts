/**
 * Action programs as intent route bodies and in dynamic nesting — construction only, offline.
 * `compose.exec.test.ts` executes a route built this way.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { actionsIntent, actionsRouteBody, compileActions } from "../src/compose.js";
import { ACTION_TYPES } from "../src/spec.js";
import type { ActionProgram } from "../src/types.js";
import { sampleProgram } from "./samples.js";
import {
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER,
  compileSauceRoute,
  renderDynamicChild,
} from "../../sdk/dist/routes/index.js";

const POT = "0x6000000000000000000000000000000000000001" as Address;
const ENGINE = "0x6000000000000000000000000000000000000002" as Address;
const PORTAL = "0x6000000000000000000000000000000000000003" as Address;
const PERSON = "0x6000000000000000000000000000000000000004" as Address;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
const WETH_BASE = "0x4200000000000000000000000000000000000006" as Address;
const ROUTER_BASE = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
const AAVE_ARB = "0x794a61358D6845594F94dc1DB02A252b5b4814aD" as Address;

const options = (extra: Record<string, unknown> = {}) => ({
  pot: POT,
  engine: ENGINE,
  portal: PORTAL,
  deadline: 2_000_000_000n,
  ...extra,
});

describe("an action program as a route body", () => {
  it("every action type compiles through the SDK route compiler (its rewrites and ambient module)", () => {
    for (const type of ACTION_TYPES) {
      if (type === "argument") continue; // a route body takes no arguments — see below
      const body = actionsRouteBody(sampleProgram(type) as unknown as ActionProgram);
      assert.doesNotMatch(
        body.source,
        /: void|: Uint256/,
        `${type}: a route body is plain JavaScript`,
      );
      const route = compileSauceRoute(
        "ethereum",
        body.source,
        { pot: POT, engine: ENGINE },
        {
          contracts: body.contracts as never,
          ambient: ["@sauce/token"],
        },
      );
      assert.equal(route.calls.length, 1, type);
    }
  });

  it("compiles to the same program the standalone compile produces", () => {
    const program = sampleProgram("uniswapV3ExactInput") as unknown as ActionProgram;
    const body = actionsRouteBody(program);
    const route = compileSauceRoute(
      "ethereum",
      body.source,
      { pot: POT, engine: ENGINE },
      {
        contracts: body.contracts as never,
      },
    );
    assert.deepEqual(route.compiled.bytecode[0], compileActions(program).bytecode);
  });

  it("refuses runtime arguments, which a route body cannot receive", () => {
    assert.throws(
      () => actionsRouteBody(sampleProgram("argument") as unknown as ActionProgram),
      /route body takes no runtime arguments, but this program declares 'amount'/,
    );
  });

  it("refuses a destination that is not the program's chain", () => {
    assert.throws(
      () => actionsIntent("base", sampleProgram("approve") as unknown as ActionProgram, options()),
      /executes on chain 1, but the route's destination is base \(8453\)/,
    );
  });

  it("refuses a caller binding that would shadow an action binding with a different ABI", () => {
    assert.throws(
      () =>
        actionsIntent(
          "ethereum",
          sampleProgram("uniswapV3ExactInput") as unknown as ActionProgram,
          {
            ...options(),
            compile: { contracts: { ISwapRouter02: { abi: [] } } },
          },
        ),
      /already binds 'ISwapRouter02' to a different ABI/,
    );
  });
});

describe("an action program in a dynamic cascade", () => {
  /** Base: swap WETH for USDC and KEEP it — `recipient: "self"` — for the child to be funded from. */
  const parentProgram: ActionProgram = {
    version: 1,
    chainId: 8453,
    actions: [
      {
        type: "approve",
        chainId: 8453,
        token: WETH_BASE,
        spender: ROUTER_BASE,
        amount: "1000000000000000000",
      },
      {
        type: "uniswapV3ExactInput",
        chainId: 8453,
        router: ROUTER_BASE,
        tokenIn: WETH_BASE,
        tokenOut: USDC_BASE,
        fee: 500,
        amountIn: "1000000000000000000",
        amountOutMin: "1",
        recipient: "self",
        deadline: 2_000_000_000,
      },
    ],
  };

  /** Arbitrum: supply WHATEVER arrived — a balanceOf action, not an amount written in advance. */
  const childProgram: ActionProgram = {
    version: 1,
    chainId: 42161,
    actions: [
      { type: "balanceOf", chainId: 42161, token: USDC_ARB },
      {
        type: "aaveV3Supply",
        chainId: 42161,
        pool: AAVE_ARB,
        token: USDC_ARB,
        onBehalfOf: PERSON,
        referralCode: 0,
      },
    ],
  };

  /** The Executor delivers the child's tokens; this precall moves them to the Pot the program runs in. */
  const toPot = (amount: bigint): Hex =>
    encodeFunctionData({
      abi: parseAbi(["function transfer(address,uint256)"]),
      functionName: "transfer",
      args: [POT, amount],
    });

  const placeholders = [
    { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn" as const, occurrences: 1 },
    // Twice: the route's token amount, and the precall that moves it to the Pot.
    { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut" as const, occurrences: 2 },
  ];
  const measure = { kind: "erc20Balance" as const, token: USDC_BASE };

  const child = actionsIntent("arbitrum", childProgram, {
    ...options({ deadline: 2_000_000_100n }),
    tokens: [{ token: USDC_ARB, amount: AMOUNT_OUT_PLACEHOLDER }],
    precalls: [{ target: USDC_ARB, data: toPot(AMOUNT_OUT_PLACEHOLDER) }],
  }).reward({
    source: "base",
    creator: PERSON,
    prover: PERSON,
    deadline: 2_000_000_200n,
    tokens: [{ token: USDC_BASE, amount: AMOUNT_IN_PLACEHOLDER }],
  });

  it("the parent's action program nests a dynamic child built from another action program", () => {
    const parent = actionsIntent("base", parentProgram, options())
      .nest(child, { via: "dynamic", measure, placeholders })
      .reward({
        source: "ethereum",
        creator: PERSON,
        prover: PERSON,
        deadline: 2_000_000_300n,
        nativeAmount: 1n,
      });

    assert.equal(parent.children.length, 1);
    // The parent route: its own action cook, then the dynamic cook that publishes the child.
    assert.equal(parent.intent.route.calls.length, 2);
  });

  it("the measured amount reaches the child's precall, so its balanceOf spends exactly that", () => {
    const measured = 123_456_789n;
    const rendered = renderDynamicChild(
      child.intent,
      { portal: PORTAL, measure, placeholders },
      measured,
    );
    // The precall now moves exactly the measured amount into the Pot...
    assert.ok(
      rendered.includes(toPot(measured).slice(2)),
      "the precall should carry the measured amount",
    );
    // ...and no sentinel is left anywhere in the published calldata.
    assert.doesNotMatch(rendered, /5acef00d/);
  });
});
