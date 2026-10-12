/**
 * A hop's hooks, `before` and `after`, each one closure or a list of them (`before: () => …`,
 * `after: [() => …, () => …]`): calls the destination Portal's Executor makes before the delivered
 * tokens move into the Pot and after the body's cook. Each closure's body
 * is one external call, which `@sauce/hop` reads as data with the compiler's
 * `callOf(closure, scope)`, in the destination's scope, and the route carries exactly as written:
 * nothing is delivered for it and no allowance is reset.
 *
 * What a program publishes is read where it runs — on an anvil standing in for Base, with
 * eco-routes' real Portal (`intent-anvil.ts`) — from the `IntentPublished` the Portal logs. Asserted:
 * the route's calls in order, each call's target, calldata and value held to viem's encoding of the
 * same call, the route's native amount, a value the program measures written into a hook's call as it
 * runs, and names resolved on the destination. One hook given alone is its one-item list, byte for
 * byte. And what is refused, located where it is written: a closure that is not one external call,
 * and a list's item that is not a closure. `await` of a hop with hooks
 * is its `.then`, byte for byte, a test skipped while the compiler has no `await` (v12 #554).
 *
 * `routes-intent-hooks.e2e.test.ts` fills such intents through the Portal's own Executor.
 */
import {
  bytesToHex,
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { Base, Ethereum } from "../src/index.js";
import type { HopHook } from "../src/routes/host-intent.js";
import { DEFAULT_REFUND_WINDOW } from "../src/routes/intent-defaults.js";
import type { IntentDefaults } from "../src/routes/intent-defaults.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import type { Intent } from "../src/routes/types.js";
import { describeEvm } from "./cli-anvil.js";
import { startIntentChain, type IntentChain } from "./intent-anvil.js";

const CREATOR = "0x4444444444444444444444444444444444444444";
const SPENDER = "0x5555555555555555555555555555555555555555";
const HOOK = "0x7777777777777777777777777777777777777777";
const DEADLINE = 2_000_000_000n;
const INTENTS = {
  deadline: DEADLINE,
  rewardDeadline: DEADLINE + DEFAULT_REFUND_WINDOW,
  salt: `0x${"5a".repeat(32)}`,
  executionFee: 1_000n,
} as const satisfies IntentDefaults;

/** Canonical Permit2, the registry's on every chain. */
const PERMIT2 = getAddress("0x000000000022d473030f116ddee9f6b43ac78ba3");
const permit2 = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const erc20 = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);
const usdcOn = (slug: string) =>
  getAddress(
    `0x${registryTokenAddress(requireChain(slug), "USDC")!.toString(16).padStart(40, "0")}`,
  );

const compile = (program: string, options: Parameters<typeof compileSauceProgram>[2] = {}) =>
  compileSauceProgram("base", program, { intents: INTENTS, ...options });

/** A hop to Arbitrum delivering 1 USDC to a program, with `hooks` among its fields. */
const hop = (hooks: string, signature = "main()") => `function ${signature} {
  Arbitrum.hop({
    send: { token: USDC, amount: 1010000 },
    receive: { token: USDC, amount: 1000000 },
    refundee: ${CREATOR},${hooks}
  }).then(() => {
    const held = USDC.balanceOf(ctx.self());
    USDC.transfer(${CREATOR}, held);
  });
}`;

/** Each route call as `[target, data, value]`, the target checksummed. */
const calls = (intent: Intent) =>
  intent.route.calls.map((call) => [
    getAddress(`0x${call.target.slice(-40)}`),
    call.data,
    call.value,
  ]);

describe("what a hook refuses, where it is written", () => {
  /** The error compiling `hooks` throws, with the compiler's code and the line it places it on. */
  const refusal = (hooks: string, signature?: string) => {
    try {
      compile(hop(hooks, signature));
    } catch (error) {
      const { message, diagnostics } = error as Error & {
        diagnostics?: readonly { code?: string; start: { line: number } }[];
      };
      return { message, code: diagnostics?.[0]?.code, line: diagnostics?.[0]?.start.line };
    }
    throw new Error("it compiled");
  };

  it.each([
    [
      "a token's write, which is SafeERC20's and more than one call",
      `before: [() => USDC.approve(${SPENDER}, 5)]`,
      /a call of a function compiled for run time/,
    ],
    [
      "two calls in one closure",
      `before: [() => { Permit2.approve(USDC, ${SPENDER}, 5, 0); Permit2.approve(USDC, ${SPENDER}, 6, 0); }]`,
      /more than one external call/,
    ],
    [
      "another effect beside the call",
      `before: [() => { evm.sstore(0, 1); Permit2.approve(USDC, ${SPENDER}, 5, 0); }]`,
      /another effect than the call/,
    ],
    [
      "a branch",
      `after: [() => { if (ctx.timestamp() > 0) { Permit2.approve(USDC, ${SPENDER}, 5, 0); } }]`,
      /a branch or a loop/,
    ],
  ])("%s: the compiler's, at the closure", (_, hooks, message) => {
    const { message: said, code, line } = refusal(`\n    ${hooks},`);
    expect(said).toMatch(message);
    expect(code).toBe("CallOfBody");
    // The hook's own line: the fields start on the hop's second.
    expect(line).toBe(6);
  });

  it("an item that is not a closure", () => {
    expect(refusal("\n    before: [5],").code).toBe("CallOfNotAClosure");
  });

  it("a field that is neither a closure nor a list", () => {
    expect(refusal("\n    after: 5,").message).toMatch(
      "`after` is a closure or a list of closures, each one external call",
    );
  });

  it("a field the hop does not take: not a member of `HopConfig`", () => {
    expect(refusal("\n    hooks: [],").message).toMatch("`hooks` is not a member of `HopConfig`");
  });
});

describe("a hop with no hooks", () => {
  it("is the program it was before hooks: empty lists change no byte", () => {
    expect(bytesToHex(compile(hop("\n    before: [],\n    after: [],")).bytecode)).toBe(
      bytesToHex(compile(hop("")).bytecode),
    );
  });
});

describe("one hook, given alone", () => {
  const approve = `() => Permit2.approve(USDC, ${SPENDER}, 5, 0)`;
  const tip = `() => evm.call(${HOOK}, 7, hex\`abcd\`)`;

  it.each([
    ["before", `before: ${approve},`, `before: [${approve}],`],
    ["after", `after: ${tip},`, `after: [${tip}],`],
    [
      "both, beside lists",
      `before: ${approve},\n    after: [${tip}, ${approve}],`,
      `before: [${approve}],\n    after: [${tip}, ${approve}],`,
    ],
  ])("%s: its one-item list, byte for byte", (_, alone, listed) => {
    expect(bytesToHex(compile(hop(`\n    ${alone}`)).bytecode)).toBe(
      bytesToHex(compile(hop(`\n    ${listed}`)).bytecode),
    );
  });

  it("is refused as a list's item is, at the closure", () => {
    expect(
      (() => {
        try {
          compile(hop(`\n    before: () => USDC.approve(${SPENDER}, 5),`));
        } catch (error) {
          return (error as { diagnostics?: readonly { code?: string }[] }).diagnostics?.[0]?.code;
        }
        throw new Error("it compiled");
      })(),
    ).toBe("CallOfBody");
  });
});

describe("`await` of a hop with hooks", () => {
  it.skip("is its `.then`, byte for byte: await dropped from the compiler (v12 #554)", () => {
    const fields = `{
    send: { token: USDC, amount: 1010000 },
    receive: { token: USDC, amount: 1000000 },
    refundee: ${CREATOR},
    before: [() => Permit2.approve(USDC, spender, 5, 0), () => evm.call(spender, 7, hex\`abcd\`)],
    after: [() => Erc20.ERC20(USDC).approve(spender, 0)],
  }`;
    const body = "const held = USDC.balanceOf(ctx.self()); USDC.transfer(spender, held);";
    const awaited = compile(
      `function main(spender: Address) {\n  await Arbitrum.hop(${fields});\n  ${body}\n}`,
    );
    const then = compile(
      `function main(spender: Address) {\n  Arbitrum.hop(${fields}).then(() => { ${body} });\n}`,
    );
    expect(bytesToHex(awaited.bytecode)).toBe(bytesToHex(then.bytecode));
  });
});

describeEvm("the hooks a program publishes", () => {
  let base: IntentChain;
  beforeAll(async () => {
    base = await startIntentChain("base", ["USDC"]);
  }, 120_000);
  afterAll(async () => {
    await base?.stop();
  });

  const published = async (program: CompiledSauceProgram, args: Hex = "0x") =>
    (await base.publish(program, args)).map(({ intent }) => intent);

  const pot = getAddress(destinationPot("arbitrum"));
  const usdc = usdcOn("arbitrum");
  const delivery: [string, Hex, bigint] = [
    usdc,
    encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 value) returns (bool)"]),
      functionName: "transfer",
      args: [pot, 1_000_000n],
    }),
    0n,
  ];

  it("each kind of call, in the order written, around the delivery and the cook", async () => {
    const program = compile(
      `import IERC20 from "./artifacts/IERC20.json";
${hop(`
    before: [
      () => Permit2.approve(USDC, ${SPENDER}, 5, 0),
      () => evm.call(${HOOK}, 7, hex\`abcd\`),
    ],
    after: [
      () => Erc20.ERC20(USDC).approve(${SPENDER}, 0),
      () => IERC20.at(${HOOK}).approve(${SPENDER}, 9),
      () => evm.call(${HOOK}, 11, hex\`\`),
    ],`)}`,
    );
    const [intent] = await published(program);
    const route = calls(intent!);
    // Names resolve on the destination: Arbitrum's Permit2 and USDC.
    expect(route.slice(0, 3)).toEqual([
      [
        PERMIT2,
        encodeFunctionData({
          abi: permit2,
          functionName: "approve",
          args: [usdc, getAddress(SPENDER), 5n, 0],
        }),
        0n,
      ],
      [getAddress(HOOK), "0xabcd", 7n],
      delivery,
    ]);
    expect(route[3]![0]).toBe(pot);
    expect(route.slice(4)).toEqual([
      [
        usdc,
        encodeFunctionData({
          abi: erc20,
          functionName: "approve",
          args: [getAddress(SPENDER), 0n],
        }),
        0n,
      ],
      [
        getAddress(HOOK),
        encodeFunctionData({
          abi: erc20,
          functionName: "approve",
          args: [getAddress(SPENDER), 9n],
        }),
        0n,
      ],
      [getAddress(HOOK), "0x", 11n],
    ]);
    // The solver brings the cook's fee and every hook's value, before and after alike; the
    // delivery is what `receive` names, and nothing for the hooks.
    expect(intent!.route.nativeAmount).toBe(INTENTS.executionFee + 7n + 11n);
    expect(
      intent!.route.tokens.map((t) => [getAddress(`0x${t.token.slice(-40)}`), t.amount]),
    ).toEqual([[usdc, 1_000_000n]]);
  }, 120_000);

  it("adds nothing for a hook: the route is the plain hop's with the hooks' calls around it", async () => {
    const [plain] = await published(compile(hop("")));
    const [hooked] = await published(
      compile(
        hop(`
    before: [() => Erc20.ERC20(USDC).approve(${SPENDER}, 5)],
    after: [() => Erc20.ERC20(USDC).approve(${SPENDER}, 6)],`),
      ),
    );
    expect(calls(hooked!).slice(1, -1)).toEqual(calls(plain!));
    // One approve each, with no reset in front, and the delivery as `receive` names it.
    expect(calls(hooked!)).toHaveLength(4);
    expect(hooked!.route.tokens).toEqual(plain!.route.tokens);
    expect(hooked!.route.nativeAmount).toBe(plain!.route.nativeAmount);
  }, 120_000);

  it("a struct, negative integers, a bool and bytes, as viem encodes them", async () => {
    const [intent] = await published(
      compile(
        hop(`
    after: [
      () => UniswapV4.PoolManager.swap(
        { currency0: USDC, currency1: ${HOOK}, fee: 500, tickSpacing: -10, hooks: 0 },
        { zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 4295128740 },
        hex\`beef\`,
      ),
    ],`),
      ),
    );
    const poolManager = parseAbi([
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
      "function swap(PoolKey key, SwapParams params, bytes hookData) returns (int256)",
    ]);
    expect(calls(intent!).at(-1)).toEqual([
      getAddress("0x360e68faccca8ca495c1b759fd9eee466db9fb32"),
      encodeFunctionData({
        abi: poolManager,
        functionName: "swap",
        args: [
          {
            currency0: usdc,
            currency1: getAddress(HOOK),
            fee: 500,
            tickSpacing: -10,
            hooks: zeroAddress,
          },
          { zeroForOne: true, amountSpecified: -1000n, sqrtPriceLimitX96: 4295128740n },
          "0xbeef",
        ],
      }),
      0n,
    ]);
  }, 120_000);

  it("fixed-size arrays of an ABI given in `contracts`", async () => {
    const grid = parseAbi(["function set(uint256[2] pair, uint256[2][2] rows, address[2] to)"]);
    const [intent] = await published(
      compile(
        hop(`
    after: [() => Grid.at(${HOOK}).set([1, 2], [[3, 4], [5, 6]], [${SPENDER}, ${HOOK}])],`),
        { intents: INTENTS, contracts: { Grid: { abi: grid as Abi } } },
      ),
    );
    expect(calls(intent!).at(-1)).toEqual([
      getAddress(HOOK),
      encodeFunctionData({
        abi: grid,
        functionName: "set",
        args: [
          [1n, 2n],
          [
            [3n, 4n],
            [5n, 6n],
          ],
          [getAddress(SPENDER), getAddress(HOOK)],
        ],
      }),
      0n,
    ]);
  }, 120_000);

  it("writes a value the program computes as it runs into the hook's call", async () => {
    // What the harness Pot holds as the program runs, which the compile never knows.
    const held = await base.local.balanceOf(base.token("USDC"), base.pot);
    const [intent] = await published(
      compile(`function main() {
  const held = USDC.balanceOf(ctx.self());
  Arbitrum.hop({
    send: { token: USDC, amount: 1010000 },
    refundee: ${CREATOR},
    before: [() => Permit2.approve(USDC, ${SPENDER}, held / 2, 0)],
  }).then(() => {});
}`),
    );
    expect(calls(intent!)[0]).toEqual([
      PERMIT2,
      encodeFunctionData({
        abi: permit2,
        functionName: "approve",
        args: [usdc, getAddress(SPENDER), held / 2n, 0],
      }),
      0n,
    ]);
  }, 120_000);
});

describe("on the host", () => {
  it("writes the hooks into the statement it compiles: a closure as declared, a call in one", () => {
    const options = { intents: INTENTS } as const;
    const built = Base.hop({
      source: Ethereum,
      send: { token: `0x${"11".repeat(20)}`, amount: 1_010_000n },
      refundee: CREATOR,
      before: [() => evm.call(0x7777777777777777777777777777777777777777n, 7n, hex`abcd`)],
      after: [`Permit2.approve(USDC, ${SPENDER}, 5, 0)`],
      compile: options,
    }).then("");
    // The closure as the host declares it (a transpiler may space the tagged template).
    expect(built.source).toMatch(
      /\n {2}before: \[\(\) => evm\.call\(0x7{40}n, 7n, hex ?`abcd`\)\],\n/,
    );
    expect(built.source).toContain(`  after: [() => Permit2.approve(USDC, ${SPENDER}, 5, 0)],\n`);
    expect(bytesToHex(built.program.bytecode)).toBe(
      bytesToHex(compileSauceProgram("ethereum", built.source, options).bytecode),
    );
  });

  it("writes one hook given alone as it is, the program its one-item list's", () => {
    const options = { intents: INTENTS } as const;
    const build = (before: HopHook | readonly HopHook[], after: HopHook | readonly HopHook[]) =>
      Base.hop({
        source: Ethereum,
        send: { token: `0x${"11".repeat(20)}`, amount: 1_010_000n },
        refundee: CREATOR,
        before,
        after,
        compile: options,
      }).then("");
    const call = () => evm.call(0x7777777777777777777777777777777777777777n, 7n, hex`abcd`);
    const approve = `Permit2.approve(USDC, ${SPENDER}, 5, 0)`;
    const alone = build(call, approve);
    expect(alone.source).toMatch(/\n {2}before: \(\) => evm\.call\(0x7{40}n, 7n, hex ?`abcd`\),\n/);
    expect(alone.source).toContain(`  after: () => ${approve},\n`);
    expect(bytesToHex(alone.program.bytecode)).toBe(
      bytesToHex(build([call], [approve]).program.bytecode),
    );
  });
});
