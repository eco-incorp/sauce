/**
 * `.before(() => { … })` and `.after(() => { … })` after `.receive(...)`: calls the Portal's
 * Executor makes around an intent's body, recorded from the closure and never compiled. What is
 * asserted is the route each builds, call by call: its order (`[before…, the delivery moved into
 * the Pot, the cook, after…]`, or `[before…, the body's calls…, after…]` for a body of token
 * writes), each call's encoding — exactly as written, with no call added and the delivery
 * untouched — where a value the program computes lands, and what is refused — a closure the compiler could not record, a Solana
 * destination, a hook out of place. And `await` of an intent with hooks is its `.then`, byte for
 * byte.
 *
 * `routes-intent-hooks.e2e.test.ts` runs the routes against eco-routes' own Portal and Executor.
 */
import {
  bytesToHex,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  zeroAddress,
  type Hex,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import type { EntryValue } from "../src/routes/entry.js";
import type { IntentSugarDefaults } from "../src/routes/intent-host.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const SPENDER = 0x5555555555555555555555555555555555555555n;
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const HOOK = 0x7777777777777777777777777777777777777777n;
const INTENTS = {
  deadline: 2_000_000_000n,
  publisher: CREATOR,
  salt: `0x${"5a".repeat(32)}`,
  executionFee: 1_000n,
} as const satisfies IntentSugarDefaults;

const compile = (program: string, args?: readonly EntryValue[]): CompiledSauceProgram =>
  compileSauceProgram("base", program, {
    defines: { SPENDER, RECIPIENT, HOOK },
    intents: INTENTS,
    ...(args === undefined ? {} : { args }),
  });

const address = (value: bigint): string => `0x${value.toString(16).padStart(40, "0")}`;
const usdc = address(registryTokenAddress(requireChain("arbitrum"), "USDC")!);
const pot = destinationPot(requireChain("arbitrum")).toLowerCase();

/** Each route call as `[target, what it does]`: an ERC-20 write with its arguments, `cook`, or
 *  any other call's data. */
function callsOf(program: CompiledSauceProgram, index = 0): [string, string][] {
  return program.intents[index]!.intent.route.calls.map((call) => {
    const target = denormalizeToEvm(call.target).toLowerCase();
    if (target === pot) return [target, `cook ${call.value}`];
    const selector = call.data.slice(0, 10);
    if (selector !== "0xa9059cbb" && selector !== "0x095ea7b3") return [target, call.data];
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
    const [to, amount] = args as readonly [string, bigint];
    return [target, `${functionName}(${to.toLowerCase()}, ${amount})`];
  });
}

const write = (token: string, method: string, to: bigint, amount: bigint): [string, string] => [
  token,
  `${method}(${address(to)}, ${amount})`,
];
const cook: [string, string] = [pot, `cook ${INTENTS.executionFee}`];
const delivered = (amount: bigint): [string, string] =>
  write(usdc, "transfer", BigInt(pot), amount);

/** An intent to Arbitrum delivering 1 USDC to a program, with `steps` between `.receive` and
 *  `.then`. */
const opened = (steps: string, body = PROGRAM) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })${steps}
    .then(() => { ${body} });
}`;
/** A body that is a program: it reads, so the compiler cannot record it. */
const PROGRAM = "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held);";

describe("the route a hook adds to", () => {
  it("`.before(...)`: its calls, then the delivery moved into the Pot, then the cook", () => {
    expect(callsOf(compile(opened(".before(() => { USDC.transfer(HOOK, 5); })")))).toEqual([
      write(usdc, "transfer", HOOK, 5n),
      delivered(1_000_000n),
      cook,
    ]);
  });

  it("`.after(...)`: the delivery, the cook, then its calls", () => {
    expect(callsOf(compile(opened(".after(() => { USDC.transfer(HOOK, 5); })")))).toEqual([
      delivered(1_000_000n),
      cook,
      write(usdc, "transfer", HOOK, 5n),
    ]);
  });

  it("several of each, and several calls in one: each in the order written", () => {
    const steps = `
    .after(() => { USDC.transfer(HOOK, 3); })
    .before(() => { USDC.transfer(HOOK, 1); Token(HOOK).transfer(SPENDER, 2); })
    .after(() => { Token(HOOK).transfer(RECIPIENT, 4); })
    .before(() => { USDC.transfer(SPENDER, 5); })`;
    expect(callsOf(compile(opened(steps)))).toEqual([
      write(usdc, "transfer", HOOK, 1n),
      write(address(HOOK), "transfer", SPENDER, 2n),
      write(usdc, "transfer", SPENDER, 5n),
      delivered(1_000_000n),
      cook,
      write(usdc, "transfer", HOOK, 3n),
      write(address(HOOK), "transfer", RECIPIENT, 4n),
    ]);
  });

  it("between the route's modifiers, in any order, changing none of them", () => {
    const plain = compile(opened(".deadline(2000000600).fee(7)"));
    const hooked = compile(
      opened(
        // Approves of zero: no reset, and nothing to deliver.
        ".before(() => { USDC.approve(HOOK, 0); }).deadline(2000000600)" +
          ".after(() => { Token(HOOK).approve(SPENDER, 0); }).fee(7)",
      ),
    );
    const [withHooks] = hooked.intents;
    const [without] = plain.intents;
    expect(withHooks!.intent.route.calls.slice(1, -1)).toEqual(without!.intent.route.calls);
    expect({ ...withHooks!.intent.route, calls: [] }).toEqual({
      ...without!.intent.route,
      calls: [],
    });
    expect(withHooks!.intent.reward).toEqual(without!.intent.reward);
  });

  it("a body of token writes: the hooks' calls around the body's own, all recorded", () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 999997 })
    .before(() => { USDC.transfer(HOOK, 1); })
    .after(() => { USDC.transfer(HOOK, 2); })
    .then(() => { USDC.transfer(RECIPIENT, 999997); });
}`;
    expect(callsOf(compile(program))).toEqual([
      write(usdc, "transfer", HOOK, 1n),
      write(usdc, "transfer", RECIPIENT, 999_997n),
      write(usdc, "transfer", HOOK, 2n),
    ]);
  });

  /** Each token the route delivers, and how much. */
  const deliveryOf = (program: CompiledSauceProgram) =>
    program.intents[0]!.intent.route.tokens.map((t) => [denormalizeToEvm(t.token), t.amount]);

  it("emits a hook's token writes exactly as written: nothing delivered, no approve reset", () => {
    const hooks = `
    .before(() => { USDC.transfer(HOOK, 1); USDC.approve(SPENDER, 9); })
    .after(() => { USDC.transfer(HOOK, 2); })`;
    const named = (receive: string, body: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive(${receive})${hooks}
    .then(() => { ${body} });
}`;
    const without = (receive: string, body: string) => named(receive, body).replace(hooks, "");
    for (const [receive, body] of [
      ["{ token: USDC, amount: 1000000 }", PROGRAM],
      ["", PROGRAM],
      ["", "USDC.transfer(RECIPIENT, 7);"],
      ["{ token: USDC, amount: 7 }", "USDC.transfer(RECIPIENT, 7);"],
    ] as const) {
      const hooked = compile(named(receive, body));
      // What the intent declares, and only that: the hooks' transfers add nothing to it.
      expect(deliveryOf(hooked)).toEqual(deliveryOf(compile(without(receive, body))));
      // The hooks' three calls, one each, around the body's.
      const calls = callsOf(hooked);
      expect(calls.slice(0, 2)).toEqual([
        write(usdc, "transfer", HOOK, 1n),
        write(usdc, "approve", SPENDER, 9n),
      ]);
      expect(calls.at(-1)).toEqual(write(usdc, "transfer", HOOK, 2n));
      expect(calls.slice(2, -1)).toEqual(callsOf(compile(without(receive, body))));
    }
    // `.receive()` naming nothing, a program body: nothing is delivered at all.
    expect(deliveryOf(compile(named("", PROGRAM)))).toEqual([]);
  });

  it("an approve is one call; a writer who needs a reset (USDT) writes it", () => {
    expect(
      callsOf(
        compile(
          opened(
            ".before(() => { USDC.approve(SPENDER, 5); USDC.approve(HOOK, 0); USDC.approve(HOOK, 6); })",
          ),
        ),
      ),
    ).toEqual([
      write(usdc, "approve", SPENDER, 5n),
      write(usdc, "approve", HOOK, 0n),
      write(usdc, "approve", HOOK, 6n),
      delivered(1_000_000n),
      cook,
    ]);
  });

  it("leaves a body of token writes as it was: its approves still reset, its transfers delivered", () => {
    expect(
      callsOf(
        compile(`function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive()
    .before(() => { USDC.approve(SPENDER, 1); })
    .then(() => { USDC.approve(HOOK, 2); USDC.transfer(RECIPIENT, 3); });
}`),
      ),
    ).toEqual([
      write(usdc, "approve", SPENDER, 1n),
      write(usdc, "approve", HOOK, 0n),
      write(usdc, "approve", HOOK, 2n),
      write(usdc, "transfer", RECIPIENT, 3n),
    ]);
  });

  it("names its tokens on the destination, at every depth", () => {
    // Base opens Arbitrum, whose body opens Optimism: each hook's USDC is its own destination's.
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .before(() => { USDC.approve(HOOK, 0); })
    .then(() => {
      Optimism.Portal.send({ token: USDC, amount: 1000000 })
        .refundee(${CREATOR})
        .receive({ token: USDC, amount: 990000 })
        .after(() => { USDC.approve(HOOK, 0); })
        .then(() => { USDC.transfer(RECIPIENT, 990000); });
    });
}`;
    const optimismUsdc = address(registryTokenAddress(requireChain("optimism"), "USDC")!);
    expect(optimismUsdc).not.toBe(usdc);
    const word = (value: string | bigint) => BigInt(value).toString(16).padStart(64, "0");
    // A route call as the route encodes it: target, data's offset, value, then the data.
    const approveOf = (token: string) =>
      `${word(token)}${word(0x60n)}${word(0n)}${word(68n)}095ea7b3${word(HOOK)}${word(0n)}`;
    const [outer] = compile(program).intents;
    // Arbitrum's hook is a call of Arbitrum's USDC.
    expect(callsOf(compile(program))[0]).toEqual(write(usdc, "approve", HOOK, 0n));
    // Optimism's intent is published by the program Arbitrum's Pot runs: its route, in that
    // program, ends with the hook's call of Optimism's USDC.
    const cook = outer!.intent.route.calls.at(-1)!.data.toLowerCase();
    expect(cook).toContain(approveOf(optimismUsdc));
    expect(cook).not.toContain(approveOf(usdc));
  });

  it("is reported as a part of the source that runs on the destination: a hook", () => {
    const source = opened(".before(() => { USDC.transfer(HOOK, 1); })");
    const parts = compile(source).elsewhere.map(({ kind, callee, chain, span }) => ({
      kind,
      callee,
      chain: chain.slug,
      text: source.slice(span.start.offset, span.end.offset),
    }));
    expect(parts).toContainEqual(
      expect.objectContaining({ kind: "hook", callee: "Received.before", chain: "arbitrum" }),
    );
    const hook = parts.find((part) => part.kind === "hook")!;
    expect(hook.text).toContain(".before(() => { USDC.transfer(HOOK, 1); })");
  });

  it("costs the solver no native: a hook's calls send none", () => {
    const [intent] = compile(
      opened(".before(() => { USDC.transfer(HOOK, 5); }).after(() => { USDC.approve(HOOK, 6); })"),
    ).intents;
    expect(intent!.intent.route.nativeAmount).toBe(INTENTS.executionFee);
  });

  it("stays outside `.catch(...)`: the handler is the cook's, the hooks the route's", () => {
    const steps =
      ".before(() => { USDC.transfer(HOOK, 1); }).after(() => { USDC.transfer(HOOK, 2); })";
    const handled = (s: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })${s}
    .then(() => { ${PROGRAM} })
    .catch((e) => { USDC.transfer(RECIPIENT, 1); });
}`;
    const withHooks = compile(handled(steps)).intents[0]!.intent.route.calls;
    const without = compile(handled("")).intents[0]!.intent.route.calls;
    // The same handled program, its cook between the hooks.
    expect(withHooks.slice(1, -1)).toEqual(without);
    expect(callsOf(compile(handled(steps)))).toEqual([
      write(usdc, "transfer", HOOK, 1n),
      delivered(1_000_000n),
      cook,
      write(usdc, "transfer", HOOK, 2n),
    ]);
  });
});

describe("the calls a hook makes", () => {
  /** Canonical Permit2, the registry's on every chain. */
  const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
  const POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
  const permit2 = parseAbi([
    "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  ]);
  const vault = parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256)"]);
  const erc20 = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);
  const poolManager = parseAbi([
    "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
    "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
    "function swap(PoolKey key, SwapParams params, bytes hookData) returns (int256)",
  ]);
  /** Each route call as `[target, data, value]`. */
  const raw = (program: CompiledSauceProgram) =>
    program.intents[0]!.intent.route.calls.map((call) => [
      denormalizeToEvm(call.target).toLowerCase(),
      call.data,
      call.value,
    ]);

  it("each kind of call, in the order written, beside token writes", () => {
    const program = compile(`import IERC20 from "./artifacts/IERC20.json";
function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .before(() => {
      USDC.approve(SPENDER, 3);
      Permit2.approve(USDC, SPENDER, 5, 0);
      Permit2.at(HOOK).approve(USDC, SPENDER, 6, 0);
      Erc4626.Vault(HOOK).deposit(7, SPENDER);
      IERC20.at(HOOK).transfer(SPENDER, 8);
      evm.call(HOOK, 9, hex\`abcd\`);
    })
    .then(() => { ${PROGRAM} });
}`);
    const approve = (amount: bigint) =>
      encodeFunctionData({
        abi: permit2,
        functionName: "approve",
        args: [getAddress(usdc), getAddress(address(SPENDER)), amount, 0],
      });
    const hook = address(HOOK);
    expect(raw(program).slice(0, -2)).toEqual([
      [
        usdc,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [getAddress(address(SPENDER)), 3n],
        }),
        0n,
      ],
      [PERMIT2, approve(5n), 0n],
      [hook, approve(6n), 0n],
      [
        hook,
        encodeFunctionData({
          abi: vault,
          functionName: "deposit",
          args: [7n, getAddress(address(SPENDER))],
        }),
        0n,
      ],
      [
        hook,
        encodeFunctionData({
          abi: erc20,
          functionName: "transfer",
          args: [getAddress(address(SPENDER)), 8n],
        }),
        0n,
      ],
      [hook, "0xabcd", 9n],
    ]);
    expect(callsOf(program).slice(-2)).toEqual([delivered(1_000_000n), cook]);
    // The native `evm.call` sends is the solver's to bring, beside the cook's fee. A contract call
    // moves no token, so it asks for no delivery.
    const [intent] = program.intents;
    expect(intent!.intent.route.nativeAmount).toBe(9n + INTENTS.executionFee);
    expect(intent!.intent.route.tokens.map((t) => t.amount)).toEqual([1_000_000n]);
  });

  it("a struct, a negative int24 and int256, a bool and bytes, as viem encodes them", () => {
    const program = compile(
      opened(`.after(() => {
      UniswapV4.PoolManager.swap(
        { currency0: USDC, currency1: HOOK, fee: 500, tickSpacing: -10, hooks: 0 },
        { zeroForOne: true, amountSpecified: -1000, sqrtPriceLimitX96: 4295128740 },
        hex\`beef\`,
      );
    })`),
    );
    expect(raw(program).at(-1)).toEqual([
      POOL_MANAGER,
      encodeFunctionData({
        abi: poolManager,
        functionName: "swap",
        args: [
          {
            currency0: getAddress(usdc),
            currency1: getAddress(address(HOOK)),
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
  });

  it("an empty hook adds nothing", () => {
    expect(callsOf(compile(opened(".before(() => {}).after(() => {})")))).toEqual([
      delivered(1_000_000n),
      cook,
    ]);
  });
});

describe("a hook's arguments", () => {
  const program = `function main(spender: Address, amount: Uint256) {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .before(() => { USDC.approve(spender, amount); })
    .then(() => { ${PROGRAM} });
}`;

  it("a value the program computes is spliced in as it runs, as a delivery amount is", () => {
    const [intent] = compile(program).intents;
    // Not known when the intent is built: two run-time values of the publication.
    expect(intent!.captures).toEqual(["spender", "amount"]);
    const approve = intent!.intent.route.calls[0]!.data;
    for (const { sentinel } of intent!.sentinels) {
      expect(approve.toLowerCase()).toContain(sentinel.toString(16));
    }
  });

  it("in a contract's method too, where the type holds a whole word", () => {
    const [intent] = compile(`function main(spender: Address, amount: Uint256) {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .after(() => { Permit2.approve(USDC, spender, amount, 0); })
    .then(() => { ${PROGRAM} });
}`).intents;
    expect(intent!.captures).toEqual(["spender", "amount"]);
    const approve = intent!.intent.route.calls.at(-1)!.data.toLowerCase();
    for (const { sentinel } of intent!.sentinels) {
      expect(approve).toContain(sentinel.toString(16).padStart(64, "0"));
    }
  });

  it("compiled for main's arguments, each is a constant there", () => {
    const [intent] = compile(program, [address(SPENDER) as Hex, 5n]).intents;
    expect(intent!.captures).toEqual([]);
    expect(callsOf(compile(program, [address(SPENDER) as Hex, 5n]))).toEqual([
      write(usdc, "approve", SPENDER, 5n),
      delivered(1_000_000n),
      cook,
    ]);
  });
});

describe("`await` of an intent with hooks", () => {
  it("is its `.then`, byte for byte: a program body and a body of token writes", () => {
    const hooks = `
    .before(() => { USDC.approve(SPENDER, 5); })
    .after(() => { USDC.transfer(HOOK, 2); })
    .before(() => { USDC.transfer(HOOK, 1); })`;
    const intent = `Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })${hooks}`;
    for (const body of [PROGRAM, "USDC.transfer(RECIPIENT, 999997);"]) {
      const awaited = compile(`function main() {\n  await ${intent};\n  ${body}\n}`);
      const then = compile(`function main() {\n  ${intent}\n    .then(() => { ${body} });\n}`);
      expect(bytesToHex(awaited.bytecode)).toBe(bytesToHex(then.bytecode));
      // Each intent, but where it is written: the two spellings place it differently.
      const unplaced = (program: CompiledSauceProgram) =>
        program.intents.map(({ span: _, ...rest }) => rest);
      expect(unplaced(awaited)).toEqual(unplaced(then));
      expect(awaited.intents[0]!.intent.route.calls.length).toBeGreaterThan(3);
    }
  });
});

describe("what a hook refuses", () => {
  /** The error compiling `steps` throws: the compiler's, located at the statement. */
  const refusal = (steps: string) => {
    try {
      compile(opened(steps));
    } catch (error) {
      return error as Error & {
        diagnostics?: readonly { code?: string; start: { line: number } }[];
      };
    }
    throw new Error("it compiled");
  };

  it.each([
    ["a local declared in it", "const n = 5; USDC.approve(SPENDER, n);", "RecordedCallsStatement"],
    ["a branch", "if (SPENDER != 0) { USDC.approve(SPENDER, 1); }", "RecordedCallsStatement"],
    ["a read whose result is dropped", "USDC.balanceOf(HOOK);", "RecordedCallsStatement"],
    [
      "a value computed as it runs",
      "USDC.approve(SPENDER, ctx.timestamp());",
      "RecordedCallsValue",
    ],
    [
      "a call in an argument",
      "USDC.transfer(SPENDER, USDC.balanceOf(HOOK));",
      "RecordedCallsValue",
    ],
  ])("%s: the compiler's error, at the statement", (_, statements, code) => {
    const error = refusal(`.before(() => { ${statements} })`);
    expect(error.message).toMatch(/`Received\.before` records/);
    expect(error.diagnostics?.[0]?.code).toBe(code);
    // The hook is on the intent's third line.
    expect(error.diagnostics?.[0]?.start.line).toBe(3);
  });

  it("names the hook it is", () => {
    expect(refusal(".after(() => { const n = 5; USDC.approve(SPENDER, n); })").message).toMatch(
      /`Received\.after` records each statement of its program as a call/,
    );
  });

  it.each([
    [
      "native an `evm.call` sends, computed as it runs",
      "function main(n: Uint256)",
      "evm.call(HOOK, n, hex`01`);",
      /the value `evm\.call\(\.\.\.\)` sends in `\.before\(\.\.\.\)` is native the solver brings/,
    ],
    [
      "calldata the program holds, which the compiler refuses to pass on",
      "function main(d: bytes)",
      "evm.call(HOOK, 0, d);",
      /a program can only read a number, an address or a bool from the program passing it/,
    ],
    [
      "a narrower integer computed as it runs",
      "function main(n: Uint256)",
      "Permit2.approve(USDC, SPENDER, 5, n);",
      /argument 4 of `\.approve\(\.\.\.\)` is a `uint48` the program computes/,
    ],
  ])("%s: it is written into the intent when it is built", (_, signature, statement, message) => {
    expect(() =>
      compile(`${signature} {
  Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive()
    .before(() => { ${statement} })
    .then(() => { USDC.transfer(RECIPIENT, 1); });
}`),
    ).toThrow(message);
  });

  it("a token known only as the program runs", () => {
    expect(() =>
      compile(`function main(token: Address) {
  Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive()
    .before(() => { Token(token).transfer(SPENDER, 1); })
    .then(() => { USDC.transfer(RECIPIENT, 1); });
}`),
    ).toThrow(/a token address must be known when the intent is built/);
  });

  it("a Solana destination, before its closure is read: its route calls name accounts", () => {
    expect(() =>
      compile(`function main() {
  Solana.Portal.send({ token: USDC, amount: 1 }).receive()
    .after(() => { USDC.transfer(SPENDER, 1); })
    .then(() => { USDC.transfer(RECIPIENT, 1); });
}`),
    ).toThrow(
      "`.after(...)` adds calls the Portal's Executor makes on an EVM destination; solana's route " +
        "calls name their accounts, which a hook has nowhere to give",
    );
  });

  it.each([
    ["before `.receive(...)`", `.before(() => { USDC.transfer(SPENDER, 1); }).receive()`, "send"],
    [
      "after `.then(...)`",
      `.receive().then(() => { USDC.transfer(RECIPIENT, 1); }).after(() => {})`,
      "then",
    ],
  ])("a hook %s is not a step there", (_, chain, after) => {
    expect(() =>
      compile(`function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1 })${chain};
}`),
    ).toThrow(new RegExp(`is not a step after \`\\.${after}\\(\\.\\.\\.\\)\``));
  });

  it("lists the hooks among the steps after `.receive(...)`", () => {
    expect(() =>
      compile(`function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive().creator(1).then(() => {});
}`),
    ).toThrow(
      "`.creator(...)` is not a step after `.receive(...)`: its steps are `.deadline(...)`, " +
        "`.salt(...)`, `.fee(...)`, `.before(...)`, `.after(...)` and `.then(...)`",
    );
  });
});
