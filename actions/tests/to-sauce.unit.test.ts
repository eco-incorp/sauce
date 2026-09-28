/**
 * Offline coverage for the lowering (`to-sauce.ts`) — no node, no network, so it runs in CI.
 *
 * What this pins is what a source generator can get wrong without anyone noticing: which contract
 * each action calls (the target literal in the source), what it calls on it (the 4-byte selector,
 * which the compiler derives from the binding's ABI and embeds in the bytecode), what native value
 * it attaches, and what its output is — for every action type. The mainnet suites execute them.
 *
 * Selectors are derived with viem's `toFunctionSelector` from the signature, so a signature edit has
 * to be made in both places to pass, and a typo in either is caught.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";

import { compileProgram } from "../src/index.js";
import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
import type { Action, ActionType } from "../src/types.js";
import { SAMPLES } from "./samples.js";

type A = `0x${string}`;

// The addresses `samples.ts` uses.
const TARGET = "0x2000000000000000000000000000000000000001";
const TOKEN = "0x1000000000000000000000000000000000000001";
const TOKEN_OUT = "0x1000000000000000000000000000000000000002";
const RECIPIENT = "0x3000000000000000000000000000000000000001";

function program(actions: Action[]) {
  return compileProgram({ version: 1, chainId: 1, actions });
}

function source(actions: Action[]): string {
  return program(actions).source;
}

/** Whether `bytecode` embeds the 4-byte selector of `sig`. */
function hasSelector(bytecode: Uint8Array, sig: string): boolean {
  return Buffer.from(bytecode).toString("hex").includes(toFunctionSelector(sig).slice(2));
}

/** An address as the SauceScript literal the emitted source carries. */
function literal(addr: string): string {
  return `0x${addr.slice(2).toLowerCase()}n`;
}

const EXACT_INPUT_SINGLE =
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";
const V4 = ["transfer(address,uint256)", "execute(bytes,bytes[])"];
const SEND_PARAM = "(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)";

/** For every action that moves anything: the contracts it calls and the selectors it carries. */
const CALLS: Record<
  Exclude<ActionType, "balanceOf" | "nativeBalance" | "argument">,
  [A[], string[]]
> = {
  uniswapV3ExactInput: [[TARGET], [EXACT_INPUT_SINGLE]],
  uniswapV3ExactInputMultiHop: [[TARGET], ["exactInput((bytes,address,uint256,uint256))"]],
  // The input token is transferred to the router first, then the router is executed.
  uniswapV4ExactInput: [[TOKEN, TARGET], V4],
  uniswapV4ExactInputMultiHop: [[TOKEN, TARGET], V4],
  // The 4-arg `exchange` returns nothing and pays the Pot, so the output is a `balanceOf` delta,
  // forwarded to the recipient.
  curveSwap: [
    [TARGET, TOKEN_OUT],
    ["exchange(int128,int128,uint256,uint256)", "balanceOf(address)", "transfer(address,uint256)"],
  ],
  curveRouterNGSwap: [
    [TARGET],
    ["exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)"],
  ],
  balancerV2Swap: [
    [TARGET],
    [
      "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
    ],
  ],
  balancerV2BatchSwap: [
    [TARGET],
    [
      "batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)",
    ],
  ],
  balancerV3Swap: [
    [TARGET],
    ["swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)"],
  ],
  uniswapV2Swap: [
    [TARGET],
    ["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"],
  ],
  ambientSwap: [[TARGET], ["userCmd(uint16,bytes)"]],
  dodoSwap: [
    [TARGET],
    ["dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)"],
  ],
  maverickSwap: [[TARGET], ["exactInputSingle(address,address,bool,uint256,uint256)"]],
  maverickMultiHopSwap: [[TARGET], ["exactInputMultiHop(address,bytes,uint256,uint256)"]],
  carbonSwap: [
    [TARGET],
    ["tradeBySourceAmount(address,address,(uint256,uint128)[],uint256,uint128)"],
  ],
  fraxswapSwap: [[TARGET], ["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"]],
  fluidDexT1Swap: [[TARGET], ["swapIn(bool,uint256,uint256,address)"]],
  acrossBridge: [
    [TARGET],
    [
      "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
    ],
  ],
  stargateBridge: [
    [TARGET],
    [`quoteSend(${SEND_PARAM},bool)`, `send(${SEND_PARAM},(uint256,uint256),address)`],
  ],
  cctpBridge: [[TARGET], ["depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)"]],
  hyperlaneBridge: [
    [TARGET],
    ["quoteGasPayment(uint32)", "transferRemote(uint32,bytes32,uint256)"],
  ],
  wrapETH: [[TARGET], ["deposit()"]],
  unwrapETH: [[TARGET], ["withdraw(uint256)"]],
  wrapStETH: [[TARGET], ["wrap(uint256)"]],
  unwrapStETH: [[TARGET], ["unwrap(uint256)"]],
  lidoStake: [[TARGET], ["submit(address)"]],
  lidoUnstake: [[TARGET], ["requestWithdrawals(uint256[],address)"]],
  rocketPoolStake: [[TARGET], ["deposit()"]],
  rocketPoolUnstake: [[TARGET], ["burn(uint256)"]],
  etherFiStake: [[TARGET], ["deposit()"]],
  aaveV3Supply: [[TARGET], ["supply(address,uint256,address,uint16)"]],
  aaveV3Withdraw: [[TARGET], ["withdraw(address,uint256,address)"]],
  aaveV3Borrow: [[TARGET], ["borrow(address,uint256,uint256,uint16,address)"]],
  aaveV3Repay: [[TARGET], ["repay(address,uint256,uint256,address)"]],
  compoundV3Supply: [[TARGET], ["supply(address,uint256)"]],
  compoundV3Withdraw: [[TARGET], ["withdraw(address,uint256)"]],
  transfer: [[TOKEN], ["transfer(address,uint256)"]],
  approve: [[TOKEN], ["approve(address,uint256)"]],
  permit2Approve: [[TARGET], ["approve(address,address,uint160,uint48)"]],
};

describe("lowering — every action type", () => {
  for (const [type, [targets, signatures]] of Object.entries(CALLS)) {
    it(`${type}: calls the right contracts with the right selectors`, () => {
      const compiled = program([SAMPLES[type as ActionType]]);
      for (const target of targets) {
        assert.ok(
          compiled.source.includes(`.at(${literal(target)})`) ||
            compiled.source.includes(`evm.call(${literal(target)}, `),
          `${type}: no call to ${target}\n${compiled.source}`,
        );
      }
      // Every generated program is a value-less `main`; the compiler rejects one with no return
      // type, so this is the annotation that keeps it compiling.
      assert.ok(compiled.source.startsWith("function main(): void {"));
      for (const sig of signatures) {
        assert.ok(
          hasSelector(compiled.bytecode, sig),
          `${type}: missing selector for ${sig}\n${compiled.source}`,
        );
      }
    });
  }

  it("covers every action type", () => {
    const covered = new Set([...Object.keys(CALLS), "balanceOf", "nativeBalance", "argument"]);
    assert.deepEqual([...covered].sort(), [...ACTION_TYPES].sort());
  });

  it("DODO's default version is the V2 entry point", () => {
    const { version: _, ...v2 } = SAMPLES.dodoSwap;
    assert.ok(
      hasSelector(
        program([v2]).bytecode,
        "dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)",
      ),
    );
  });
});

describe("lowering — native value", () => {
  const attaches: Partial<Record<ActionType, RegExp>> = {
    wrapETH: /1000n/,
    lidoStake: /1000n/,
    rocketPoolStake: /1000n/,
    etherFiStake: /1000n/,
    // The fee each bridge quoted on-chain, just before the send.
    stargateBridge: /lzfee\d+/,
    hyperlaneBridge: /igp\d+/,
  };

  for (const [type, value] of Object.entries(attaches)) {
    it(`${type} attaches ${value.source}`, () => {
      const text = source([SAMPLES[type as ActionType]]);
      assert.match(text, new RegExp(`evm\\.call\\(${literal(TARGET)}, ${value.source}, `), text);
    });
  }

  it("the bridges quote their fee with a static call before paying it", () => {
    assert.match(
      source([SAMPLES.stargateBridge]),
      /const lz\d+ = IStargatePool\.at\(0x2000000000000000000000000000000000000001n\)\.quoteSend\(\{ dstEid: 30110n, to: 0x0{24}3000000000000000000000000000000000000001n, amountLD: 1000n, minAmountLD: 990n,/,
    );
    assert.match(
      source([SAMPLES.hyperlaneBridge]),
      /const igp\d+ = IWarpRoute\.at\(0x2000000000000000000000000000000000000001n\)\.quoteGasPayment\(10n\);/,
    );
  });

  it("every other action attaches nothing, and its raw calls are ERC-20 writes", () => {
    for (const type of ACTION_TYPES) {
      if (type in attaches) continue;
      const text = source(sampleList(type));
      assert.doesNotMatch(text, /evm\.call\(0x[0-9a-f]+n, (?!0n)[^,]+, /, `${type}\n${text}`);
      for (const [, data] of text.matchAll(/evm\.call\(0x[0-9a-f]+n, 0n, (\w+)/g)) {
        assert.match(text, new RegExp(`const ${data} = hex\`(a9059cbb|095ea7b3)`), text);
      }
    }
  });
});

/** The sample, followed by an action that spends its output when it is a source. */
function sampleList(type: ActionType): Action[] {
  const sample = SAMPLES[type];
  return ACTION_SPECS[type].group === "source"
    ? [sample, { type: "approve", token: TOKEN, spender: TARGET }]
    : [sample];
}

describe("lowering — outputs follow the spec", () => {
  /** The expression a saved action stores: the right-hand side of `let v_out = …;`. */
  const stored = (type: ActionType): string => {
    const text = source([{ ...SAMPLES[type], saveOutputAs: "out" } as Action]);
    const m = text.match(/let v_out = (.+);/);
    assert.ok(m, `${type}: expected a stored output\n${text}`);
    return m[1]!;
  };

  for (const type of ACTION_TYPES) {
    const { output, group } = ACTION_SPECS[type];
    if (group === "source") continue;
    it(`${type}: ${output === "realized" ? "a realized amount" : "its own amount"}`, () => {
      const value = stored(type);
      if (output === "passThrough") assert.equal(value, "1000n");
      else assert.match(value, /^(amt|delta)\d+$/);
    });
  }

  it("a balance-delta output brackets the call with two readings", () => {
    for (const type of ["uniswapV2Swap", "lidoStake", "rocketPoolStake", "etherFiStake"] as const) {
      const text = source([{ ...SAMPLES[type], saveOutputAs: "out" }]);
      assert.equal(text.match(/\.balanceOf\(ctx\.self\(\)\)/g)?.length, 2, text);
      assert.match(text, /const delta\d+ = bal\d+ - bal\d+;/);
    }
    const unstake = source([{ ...SAMPLES.rocketPoolUnstake, saveOutputAs: "out" }]);
    assert.equal(unstake.match(/ctx\.selfBalance\(\)/g)?.length, 2, unstake);
  });

  it("an unread output is not measured", () => {
    assert.doesNotMatch(source([SAMPLES.uniswapV2Swap]), /balanceOf/);
    assert.doesNotMatch(source([SAMPLES.lidoStake]), /balanceOf/);
  });
});

describe("lowering — bridges", () => {
  it("a remote recipient is a 32-byte word: an address left-padded, an account as written", () => {
    assert.match(source([SAMPLES.cctpBridge]), new RegExp(`0x${"ab".repeat(32)}n`));
    assert.match(
      source([SAMPLES.hyperlaneBridge]),
      /0x0{24}3000000000000000000000000000000000000001n/,
    );
  });

  it("Across delivers the amount less the relayer fee, and refunds the Pot", () => {
    const text = source([SAMPLES.acrossBridge]);
    assert.match(text, /const out\d+ = 1000n - 10n;/);
    assert.match(text, /depositV3\(ctx\.self\(\), 0x3000000000000000000000000000000000000001n,/);
    const free = source([{ ...SAMPLES.acrossBridge, relayerFee: "0" }]);
    assert.doesNotMatch(free, /const out\d+/);
  });

  it("CCTP defaults to a free, finalized transfer", () => {
    const { maxFee: _, minFinalityThreshold: __, ...bare } = SAMPLES.cctpBridge;
    assert.match(source([bare]), /, 0n, 0n, 2000n\);/);
  });
});

describe("lowering — sources", () => {
  it("balanceOf reads the Pot's balance and the next action spends it", () => {
    const text = source([
      { type: "balanceOf", token: TOKEN },
      { type: "transfer", token: TOKEN, recipient: RECIPIENT },
    ]);
    assert.match(
      text,
      /const bal0 = IErc20\.at\(0x1000000000000000000000000000000000000001n\)\.balanceOf\(ctx\.self\(\)\);/,
    );
    assert.match(text, /let t_out0 = bal0;/);
    assert.match(text, /hex`a9059cbb[0-9a-f]*3000000000000000000000000000000000000001`;/);
    assert.match(text, /\.concat\(t_out0\.toBytesBe\(32\)\)/);
  });

  it("nativeBalance reads ctx.selfBalance()", () => {
    const text = source([{ type: "nativeBalance" }, { type: "wrapETH", weth: TARGET }]);
    assert.match(text, /const nat0 = ctx\.selfBalance\(\);/);
    assert.match(text, /evm\.call\(0x2000000000000000000000000000000000000001n, t_out0, sel\d+\);/);
  });

  it("argument becomes a typed `main` parameter, in declaration order", () => {
    const compiled = program([
      { type: "argument", name: "first", saveOutputAs: "first" },
      { type: "argument", name: "second" },
      { type: "approve", token: TOKEN, spender: TARGET },
      { type: "transfer", token: TOKEN, recipient: RECIPIENT, amountRef: "first" },
    ]);
    assert.ok(
      compiled.source.startsWith("function main(a_first: Uint256, a_second: Uint256): void {"),
    );
    assert.deepEqual(compiled.parameters, ["first", "second"]);
  });
});

describe("lowering — chaining", () => {
  const v3 = (extra: Partial<Action> = {}): Action =>
    ({ ...SAMPLES.uniswapV3ExactInput, ...extra }) as Action;

  it("independent swaps keep their recipients and capture nothing", () => {
    const other = "0x3000000000000000000000000000000000000002";
    const text = source([v3(), v3({ recipient: other } as Partial<Action>)]);
    assert.ok(text.includes(`recipient: ${literal(RECIPIENT)}`));
    assert.ok(text.includes(`recipient: ${literal(other)}`));
    assert.doesNotMatch(text, /recipient: ctx\.self\(\)/);
    assert.doesNotMatch(text, /let t_out/);
  });

  it("an implicit chain captures only the action it follows, and delivers it to the Pot", () => {
    const text = source([v3(), v3(), v3({ amount: undefined })]);
    assert.equal(text.match(/recipient: ctx\.self\(\)/g)?.length, 1);
    assert.doesNotMatch(text, /let t_out0/);
    assert.match(text, /let t_out1 = amt\d+;/);
    assert.match(text, /amountIn: t_out1,/);
  });

  it("saveOutputAs binds a local, and amountRef reads it", () => {
    const text = source([
      v3({ saveOutputAs: "swapOut" }),
      { type: "transfer", token: TOKEN_OUT, recipient: RECIPIENT, amountRef: "swapOut" },
    ]);
    assert.match(text, /let v_swapOut = amt\d+;/);
    assert.match(text, /\.concat\(v_swapOut\.toBytesBe\(32\)\)/);
  });

  it("two actions saving to the same name assign rather than re-declare", () => {
    const text = source([
      v3({ saveOutputAs: "out" }),
      v3({ saveOutputAs: "out" }),
      { type: "transfer", token: TOKEN_OUT, recipient: RECIPIENT, amountRef: "out" },
    ]);
    assert.equal(text.match(/let v_out = /g)?.length, 1);
    assert.equal(text.match(/^ {2}v_out = /gm)?.length, 1);
  });

  it("the same program always lowers to the same source", () => {
    const actions = [SAMPLES.curveSwap, SAMPLES.uniswapV2Swap];
    assert.equal(source(actions), source(actions));
  });
});
