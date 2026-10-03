/**
 * `.before(() => { … })` and `.after(() => { … })` after `.receive(...)`: calls the Portal's
 * Executor makes around an intent's body, recorded from the closure and never compiled. What is
 * asserted is the route each builds, call by call: its order (`[before…, the delivery moved into
 * the Pot, the cook, after…]`, or `[before…, the body's calls…, after…]` for a body of token
 * writes), each call's encoding, the reset in front of every approve, where a value the program
 * computes lands, and what is refused — a closure the compiler could not record, a Solana
 * destination, a hook out of place. And `await` of an intent with hooks is its `.then`, byte for
 * byte.
 *
 * `routes-intent-hooks.e2e.test.ts` runs the routes against eco-routes' own Portal and Executor.
 */
import { bytesToHex, decodeFunctionData, erc20Abi, type Hex } from "viem";

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

/** Each route call as `[target, what it does]`: an ERC-20 write with its arguments, or `cook`. */
function callsOf(program: CompiledSauceProgram, index = 0): [string, string][] {
  return program.intents[index]!.intent.route.calls.map((call) => {
    const target = denormalizeToEvm(call.target).toLowerCase();
    if (target === pot) return [target, `cook ${call.value}`];
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

  it("delivers what the hooks' transfers move on top of what `.receive(...)` names: it is the body's", () => {
    const hooks = `
    .before(() => { USDC.transfer(HOOK, 1); USDC.approve(SPENDER, 9); })
    .after(() => { USDC.transfer(HOOK, 2); })`;
    // A program: what `.receive(...)` names moves into its Pot whole, and the hooks spend their
    // own. An approve moves nothing.
    const compiled = compile(opened(hooks));
    expect(deliveryOf(compiled)).toEqual([
      [usdc, 1n],
      [usdc, 1_000_000n],
      [usdc, 2n],
    ]);
    expect(callsOf(compiled)).toEqual([
      write(usdc, "transfer", HOOK, 1n),
      write(usdc, "approve", SPENDER, 0n),
      write(usdc, "approve", SPENDER, 9n),
      delivered(1_000_000n),
      cook,
      write(usdc, "transfer", HOOK, 2n),
    ]);

    const named = (receive: string, body: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive(${receive})${hooks}
    .then(() => { ${body} });
}`;
    // `.receive()` naming nothing: a body of token writes is delivered what it moves, between the
    // hooks'; a program, nothing, and only the hooks' transfers reach the Executor.
    expect(deliveryOf(compile(named("", "USDC.transfer(RECIPIENT, 7);")))).toEqual([
      [usdc, 1n],
      [usdc, 7n],
      [usdc, 2n],
    ]);
    const nothing = compile(named("", PROGRAM));
    expect(deliveryOf(nothing)).toEqual([
      [usdc, 1n],
      [usdc, 2n],
    ]);
    expect(callsOf(nothing)).not.toContainEqual(delivered(1n));
    // A body of token writes given a delivery takes it as it is.
    expect(
      deliveryOf(compile(named("{ token: USDC, amount: 7 }", "USDC.transfer(RECIPIENT, 7);"))),
    ).toEqual([
      [usdc, 1n],
      [usdc, 7n],
      [usdc, 2n],
    ]);
  });

  it("resets every approve to zero first, as the Executor's other approves are; not one of zero", () => {
    expect(
      callsOf(
        compile(
          opened(".before(() => { USDC.approve(SPENDER, 5); Token(HOOK).approve(SPENDER, 0); })"),
        ),
      ),
    ).toEqual([
      write(usdc, "approve", SPENDER, 0n),
      write(usdc, "approve", SPENDER, 5n),
      write(address(HOOK), "approve", SPENDER, 0n),
      delivered(1_000_000n),
      cook,
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
    const approve = intent!.intent.route.calls[1]!.data;
    for (const { sentinel } of intent!.sentinels) {
      expect(approve.toLowerCase()).toContain(sentinel.toString(16));
    }
  });

  it("compiled for main's arguments, each is a constant there", () => {
    const [intent] = compile(program, [address(SPENDER) as Hex, 5n]).intents;
    expect(intent!.captures).toEqual([]);
    expect(callsOf(compile(program, [address(SPENDER) as Hex, 5n]))).toEqual([
      write(usdc, "approve", SPENDER, 0n),
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
      expect(awaited.intents).toEqual(then.intents);
      expect(awaited.intents[0]!.intent.route.calls.length).toBeGreaterThan(3);
    }
  });
});

describe("what a hook refuses", () => {
  const RECORDS =
    /`\.before\(\.\.\.\)` records calls for the Portal's Executor to make, and is never compiled/;

  it.each([
    ["a local declared in it", ".before(() => { const n = 5; USDC.approve(SPENDER, n); })"],
    ["an argument it computes", ".before(() => { USDC.approve(SPENDER, 2 * 3); })"],
    ["a read", ".before(() => { USDC.transfer(SPENDER, USDC.balanceOf(HOOK)); })"],
    ["a branch", ".before(() => { if (SPENDER != 0) { USDC.approve(SPENDER, 1); } })"],
    ["a contract's function", ".before(() => { Permit2.approve(USDC, SPENDER, 5, 0); })"],
    ["a raw call", ".before(() => { evm.call(HOOK, 0, hex`01`); })"],
    ["an empty closure", ".before(() => {})"],
  ])("%s: the compiler could not record it", (_, steps) => {
    expect(() => compile(opened(steps))).toThrow(RECORDS);
  });

  it("names the hook it is", () => {
    expect(() =>
      compile(opened(".after(() => { const n = 5; USDC.approve(SPENDER, n); })")),
    ).toThrow(/`\.after\(\.\.\.\)` records calls for the Portal's Executor to make/);
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
