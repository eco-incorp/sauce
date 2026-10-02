/**
 * Offline coverage for the lowering (`to-sauce.ts`) — no node, no network, so it runs in CI.
 *
 * What this pins is what a source generator can get wrong without anyone noticing: which contract
 * each action calls (the target literal in the source), what it calls on it (the 4-byte selector,
 * which the compiler derives from the binding's ABI and embeds in the bytecode), what native value
 * it attaches, and what its output is — for every action type. The mainnet suites execute them.
 *
 * Selectors are derived with viem's `toFunctionSelector` from the signature, so a signature edit has
 * to be made in both places to pass, and a typo in either is caught. A swap at one of
 * `@sauce/router`'s venues is a call into that library: its targets are the call's arguments, and
 * its selectors are compiled into the program from the library's own ABIs.
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
  return `0x${addr.slice(2).toLowerCase()}`;
}

const POOL_KEY = "(address,address,uint24,int24,address)";
const SEND_PARAM = "(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)";

/** For every action that moves anything: the contracts it calls and the selectors it carries. */
const CALLS: Record<
  Exclude<ActionType, "balanceOf" | "nativeBalance" | "argument">,
  [A[], string[]]
> = {
  // The `@sauce/router` venues: what each library function calls.
  uniswapV2Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    ["getReserves()", "transfer(address,uint256)", "swap(uint256,uint256,address,bytes)"],
  ],
  uniswapV3Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    ["swapV3(address,address,address,int256,uint160,address,address)"],
  ],
  uniswapV4Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    [`swapV4(address,${POOL_KEY},bool,int256,uint160,address,address)`],
  ],
  curveSwap: [
    [TARGET, TOKEN, TOKEN_OUT],
    [
      "approve(address,uint256)",
      "exchange(int128,int128,uint256,uint256)",
      "balanceOf(address)",
      "transfer(address,uint256)",
    ],
  ],
  balancerV2Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    [
      "approve(address,uint256)",
      "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
    ],
  ],
  dodoV2Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    ["transfer(address,uint256)", "sellBase(address)", "sellQuote(address)"],
  ],
  traderJoeLBSwap: [
    [TARGET, TOKEN, TOKEN_OUT],
    ["transfer(address,uint256)", "swap(bool,address)"],
  ],
  woofiSwap: [
    [TARGET, TOKEN, TOKEN_OUT],
    ["transfer(address,uint256)", "swap(address,address,uint256,uint256,address,address)"],
  ],
  maverickV2Swap: [
    [TARGET, TOKEN, TOKEN_OUT],
    [`swap((uint8,address,${POOL_KEY},address,address,int256,uint160,address,address,bytes))`],
  ],
  // The other venues: their own bindings.
  curveRouterNGSwap: [
    [TARGET],
    ["exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)"],
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
  ambientSwap: [[TARGET], ["userCmd(uint16,bytes)"]],
  dodoV1Swap: [
    [TARGET],
    ["dodoSwapV1(address,address,uint256,uint256,address[],uint256,bool,uint256)"],
  ],
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

/** The `@sauce/router` function each library-backed swap action calls. */
const ROUTER: Partial<Record<ActionType, string>> = {
  uniswapV2Swap: "uniswapV2",
  uniswapV3Swap: "uniswapV3",
  uniswapV4Swap: "uniswapV4",
  curveSwap: "curve",
  balancerV2Swap: "balancerV2",
  dodoV2Swap: "dodoV2",
  traderJoeLBSwap: "traderJoeLB",
  woofiSwap: "woofi",
  maverickV2Swap: "maverickV2",
};

describe("lowering — every action type", () => {
  for (const [type, [targets, signatures]] of Object.entries(CALLS)) {
    it(`${type}: calls the right contracts with the right selectors`, () => {
      const compiled = program([SAMPLES[type as ActionType]]);
      const library = ROUTER[type as ActionType];
      for (const target of targets) {
        // A binding call names its target; a library call takes it as an argument.
        const named =
          library === undefined
            ? compiled.source.includes(`.at(${literal(target)})`) ||
              compiled.source.includes(`evm.call(${literal(target)}, `)
            : new RegExp(`${library}\\([^;]*${literal(target)}`).test(compiled.source);
        assert.ok(named, `${type}: no call to ${target}\n${compiled.source}`);
      }
      // Every generated program is a value-less `main`; the compiler rejects one with no return
      // type, so this is the annotation that keeps it compiling. A library call imports the function.
      const head = library === undefined ? "" : `import { ${library} } from "@sauce/router";\n\n`;
      assert.ok(compiled.source.startsWith(`${head}function main(): void {`), compiled.source);
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

  it("each swap at a @sauce/router venue is one call into that library, and nothing else", () => {
    for (const [type, fn] of Object.entries(ROUTER)) {
      const text = source([SAMPLES[type as ActionType]]);
      assert.equal(text.match(new RegExp(`\\b${fn}\\(`, "g"))?.length, 1, `${type}\n${text}`);
      assert.doesNotMatch(text, /\.at\(|evm\.call/, `${type} calls no contract itself`);
    }
  });
});

describe("lowering — native value", () => {
  const attaches: Partial<Record<ActionType, RegExp>> = {
    wrapETH: /1000/,
    lidoStake: /1000/,
    rocketPoolStake: /1000/,
    etherFiStake: /1000/,
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
      /const lz\d+ = IStargatePool\.at\(0x2000000000000000000000000000000000000001\)\.quoteSend\(\{ dstEid: 30110, to: 0x0{24}3000000000000000000000000000000000000001, amountLD: 1000, minAmountLD: 990,/,
    );
    assert.match(
      source([SAMPLES.hyperlaneBridge]),
      /const igp\d+ = IWarpRoute\.at\(0x2000000000000000000000000000000000000001\)\.quoteGasPayment\(10\);/,
    );
  });

  it("every other action attaches nothing, and its raw calls are ERC-20 writes", () => {
    for (const type of ACTION_TYPES) {
      if (type in attaches) continue;
      const text = source(sampleList(type));
      assert.doesNotMatch(
        text,
        /evm\.call\((0x[0-9a-f]+|[0-9]+), (?!0,)[^,]+, /,
        `${type}\n${text}`,
      );
      for (const [, , data] of text.matchAll(/evm\.call\((0x[0-9a-f]+|[0-9]+), 0, (\w+)/g)) {
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
      if (output === "passThrough") assert.equal(value, "1000");
      else assert.match(value, /^(amt|delta)\d+$|^swap\d+out$/);
    });
  }

  it("a balance-delta output brackets the call with two readings", () => {
    for (const type of ["fraxswapSwap", "lidoStake", "rocketPoolStake", "etherFiStake"] as const) {
      const text = source([{ ...SAMPLES[type], saveOutputAs: "out" }]);
      assert.equal(text.match(/\.balanceOf\(ctx\.self\(\)\)/g)?.length, 2, text);
      assert.match(text, /const delta\d+ = bal\d+ - bal\d+;/);
    }
    const unstake = source([{ ...SAMPLES.rocketPoolUnstake, saveOutputAs: "out" }]);
    assert.equal(unstake.match(/ctx\.selfBalance\(\)/g)?.length, 2, unstake);
  });

  it("an unread output is not measured", () => {
    assert.doesNotMatch(source([SAMPLES.fraxswapSwap]), /balanceOf/);
    assert.doesNotMatch(source([SAMPLES.lidoStake]), /balanceOf/);
  });
});

describe("lowering — bridges", () => {
  it("a remote recipient is a 32-byte word: an address left-padded, an account as written", () => {
    assert.match(source([SAMPLES.cctpBridge]), new RegExp(`0x${"ab".repeat(32)}`));
    assert.match(
      source([SAMPLES.hyperlaneBridge]),
      /0x0{24}3000000000000000000000000000000000000001/,
    );
  });

  it("Across delivers the amount less the relayer fee, and refunds the Pot", () => {
    const text = source([SAMPLES.acrossBridge]);
    assert.match(text, /const out\d+ = 1000 - 10;/);
    assert.match(text, /depositV3\(ctx\.self\(\), 0x3000000000000000000000000000000000000001,/);
    const free = source([{ ...SAMPLES.acrossBridge, relayerFee: "0" }]);
    assert.doesNotMatch(free, /const out\d+/);
  });

  it("CCTP defaults to a free, finalized transfer", () => {
    const { maxFee: _, minFinalityThreshold: __, ...bare } = SAMPLES.cctpBridge;
    assert.match(source([bare]), /, 0, 0, 2000\);/);
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
      /const bal0 = IErc20\.at\(0x1000000000000000000000000000000000000001\)\.balanceOf\(ctx\.self\(\)\);/,
    );
    assert.match(text, /let t_out0 = bal0;/);
    assert.match(text, /hex`a9059cbb[0-9a-f]*3000000000000000000000000000000000000001`;/);
    assert.match(text, /\.concat\(t_out0\.toBytesBe\(32\)\)/);
  });

  it("nativeBalance reads ctx.selfBalance()", () => {
    const text = source([{ type: "nativeBalance" }, { type: "wrapETH", weth: TARGET }]);
    assert.match(text, /const nat0 = ctx\.selfBalance\(\);/);
    assert.match(text, /evm\.call\(0x2000000000000000000000000000000000000001, t_out0, sel\d+\);/);
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
    ({ ...SAMPLES.uniswapV3Swap, ...extra }) as Action;

  it("independent swaps keep their recipients and capture nothing", () => {
    const other = "0x3000000000000000000000000000000000000002";
    const text = source([v3(), v3({ recipient: other } as Partial<Action>)]);
    assert.ok(text.includes(`, ${literal(RECIPIENT)});`));
    assert.ok(text.includes(`, ${literal(other)});`));
    assert.doesNotMatch(text, /ctx\.self\(\)\);/);
    assert.doesNotMatch(text, /let t_out/);
  });

  it("an implicit chain captures only the action it follows, and delivers it to the Pot", () => {
    const text = source([v3(), v3(), v3({ amount: undefined })]);
    assert.equal(text.match(/ctx\.self\(\)\);/g)?.length, 1);
    assert.doesNotMatch(text, /let t_out0/);
    assert.match(text, /const amt\d+ = uniswapV3\(.*, ctx\.self\(\)\);/);
    assert.match(text, /let t_out1 = amt\d+;/);
    assert.match(text, /uniswapV3\(0x[0-9a-f]+, 0x[0-9a-f]+, 0x[0-9a-f]+, t_out1, /);
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
