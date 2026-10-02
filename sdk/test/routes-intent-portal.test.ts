/**
 * `Chain.Portal.send(reward)[modifiers].receive(delivery)[modifiers].then(body)` is
 * `Chain(body, { tokens: delivery }).reward({ tokens: reward })` with the option each modifier sets,
 * and with each default's value where a modifier is left out, byte for byte.
 *
 * In a program: every compile the pipeline makes — the program's, and each nested intent's — is
 * recorded for both spellings and compared, so each level's lowered source, defines and bytecode
 * (which carries that level's `publish` calldata) must match, as must each intent the program
 * opens. The programs run on Base and open intents to Arbitrum and then Optimism, where `USDC` is a
 * different address each time, so a level resolving a name on the wrong chain differs.
 *
 * The defaults: the route's deadline `DEFAULT_FILL_WINDOW` past when the intent opens — when the
 * compile says, else `ctx.timestamp()` as the program runs — the reward's `DEFAULT_REFUND_WINDOW`
 * past that, a random salt, each destination's own Kitchen fee. The creator has none: every intent
 * a program opens names its own, but a top-level one a wallet publishes itself (`publisher`).
 *
 * On the host: `Base.Portal.send(...)...then(body)` builds the intent `Base(body,
 * options).reward(reward)` builds, and its `then` refuses to be a promise's.
 *
 * And what the lowering refuses, by name: an expression that stops before its body, steps or
 * modifiers out of place or repeated, a list not written out, native coin delivered, a fee computed
 * as it runs, a creator nobody named; and an amount's arithmetic that would revert.
 */
import { bytesToHex, decodeFunctionData, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { DEFAULT_FILL_WINDOW, DEFAULT_REFUND_WINDOW } from "../src/routes/intent-portal.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { Token } from "../src/token/api.js";

// ESM jest exposes `jest` on `import.meta`, and every module that compiles must be imported AFTER
// the mock is registered, so those imports are dynamic.
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
const real = await import("../src/routes/rs-compile.js");

interface Compile {
  readonly source: string;
  readonly defines: Readonly<Record<string, bigint | boolean | number>>;
  readonly bytecode: Hex;
}
let compiles: Compile[] = [];
jest.unstable_mockModule("../src/routes/rs-compile.js", () => ({
  ...real,
  compileWithRs: (input: Parameters<typeof real.compileWithRs>[0]) => {
    const result = real.compileWithRs(input);
    compiles.push({
      source: input.source,
      defines: input.defines ?? {},
      bytecode: bytesToHex(result.bytecode[0]!),
    });
    return result;
  },
}));
const { compileSauceProgram } = await import("../src/routes/sauce-route.js");
const { openRoute } = await import("../src/routes/intent-dsl.js");
const { destinationPot } = await import("../src/routes/intent-pot.js");
const { hashIntent } = await import("../src/routes/encode.js");
const { publishTx } = await import("../src/routes/portal.js");
const { Arbitrum, Base, Ethereum } = await import("../src/index.js");

/** Runs `build` and returns every compile it made, in order, with what it returned. */
function record<T>(build: () => T): { readonly result: T; readonly compiles: Compile[] } {
  compiles = [];
  const result = build();
  return { result, compiles };
}

const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const DEADLINE = 2_000_000_000n;
/** The reward's deadline the portal form defaults to, given the route's. */
const REWARD_DEADLINE = DEADLINE + DEFAULT_REFUND_WINDOW;
const SALT = `0x${"5a".repeat(32)}` as const;
/** A top-level intent's creator, as the wallet publishing it: the call form's `creator`, the portal
 *  form's `publisher`. One salt for both: the portal form's own default is random. */
const INTENTS = {
  deadline: DEADLINE,
  creator: CREATOR,
  publisher: CREATOR,
  salt: SALT,
  executionFee: 1_000n,
};
/** The call form takes the reward's deadline as given: the portal form's default, here. */
const CALL_INTENTS = { ...INTENTS, rewardDeadline: REWARD_DEADLINE };
const usdcOf = (slug: string): bigint => registryTokenAddress(requireChain(slug), "USDC")!;
const hex = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

/** A pair of programs: the portal form and the call form it means. */
interface Pair {
  readonly name: string;
  readonly portal: string;
  readonly call: string;
  /** The chains each level's intent goes to, outermost first. */
  readonly destinations: readonly string[];
}

const PAIRS: readonly Pair[] = [
  {
    name: "one level, a body of token writes, one item each",
    portal: `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => {
      USDC.transfer(RECIPIENT, 1000000);
    });
}`,
    call: `function main() {
  Arbitrum(() => {
      USDC.transfer(RECIPIENT, 1000000);
    }, { tokens: [{ token: USDC, amount: 1000000 }] }).reward({ tokens: [{ token: USDC, amount: 1010000 }] });
}`,
    destinations: ["arbitrum"],
  },
  {
    name: "one level, a program body, arrays, a run-time amount and arithmetic",
    portal: `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99 / 100 }])
    .then(() => {
      USDC.transfer(recipient, amount * 99 / 100);
    });
}`,
    call: `function main(amount: Uint256, recipient: Address) {
  Arbitrum(() => {
      USDC.transfer(recipient, amount * 99 / 100);
    }, { tokens: [{ token: USDC, amount: amount * 99 / 100 }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
    destinations: ["arbitrum"],
  },
  {
    name: "nested: Base opens Arbitrum, whose body opens Optimism",
    portal: `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99 / 100 }])
    .then(() => {
      USDC.transfer(recipient, amount * 99 / 100 / 2);
      Optimism.Portal.send({ token: USDC, amount: amount * 99 / 100 / 2 })
        .creator(${CREATOR})
        .receive({ token: USDT, amount: amount * 98 / 100 / 2 })
        .then(() => { USDT.transfer(recipient, amount * 98 / 100 / 2); });
    });
}`,
    call: `function main(amount: Uint256, recipient: Address) {
  Arbitrum(() => {
      USDC.transfer(recipient, amount * 99 / 100 / 2);
      Optimism(() => { USDT.transfer(recipient, amount * 98 / 100 / 2); }, { tokens: [{ token: USDT, amount: amount * 98 / 100 / 2 }] })
        .reward({ tokens: [{ token: USDC, amount: amount * 99 / 100 / 2 }] });
    }, { tokens: [{ token: USDC, amount: amount * 99 / 100 }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
    destinations: ["arbitrum", "optimism"],
  },
];

/** `program` with main's arguments bound as compile-time values, as `--args` binds them. */
const bound = (program: string) => program.replace(/main\([^)]*\)/, "main()");
const ARGS = { RECIPIENT, amount: 1_000_000n, recipient: RECIPIENT };

type Intents = typeof INTENTS & { readonly rewardDeadline?: bigint };

/** The ways a program opening an intent is compiled: as a program taking its arguments at run
 *  time, as one with them bound, and as a route's body. */
const PATHS = [
  [
    "compileSauceProgram",
    (program: string, intents: Intents) =>
      compileSauceProgram("base", program, { defines: { RECIPIENT }, intents }).intents,
  ],
  [
    "compileSauceProgram, its arguments bound",
    (program: string, intents: Intents) =>
      compileSauceProgram("base", bound(program), { defines: ARGS, intents }).intents,
  ],
  [
    "Base(program, options).reward(...)",
    (program: string, intents: Intents) => [
      openRoute("base", bound(program), {
        deadline: DEADLINE,
        creator: CREATOR,
        source: "ethereum",
        defines: ARGS,
        compile: { intents },
      }).reward({ tokens: [] }).intent,
    ],
  ],
] as const;

describe.each(PATHS)("through %s", (_path, build) => {
  it.each(PAIRS)("$name: every level compiles to the same bytes", (pair) => {
    const portal = record(() => build(pair.portal, INTENTS));
    const call = record(() => build(pair.call, CALL_INTENTS));
    // One compile per level, the innermost first, and every one the same.
    expect(portal.compiles).toHaveLength(call.compiles.length);
    portal.compiles.forEach((compile, i) => {
      expect(compile.source).toBe(call.compiles[i]!.source);
      expect(compile.defines).toEqual(call.compiles[i]!.defines);
      expect(compile.bytecode).toBe(call.compiles[i]!.bytecode);
    });
    expect(portal.result).toEqual(call.result);
  });
});

describe("the intents a program opens", () => {
  const portalOn = { portal: ecoRoutesPortal(requireChain("base")) };

  it.each(PAIRS)("$name: the same intent, hash and publish calldata", (pair) => {
    const [portal] = compileSauceProgram("base", bound(pair.portal), {
      defines: ARGS,
      intents: INTENTS,
    }).intents;
    const [call] = compileSauceProgram("base", bound(pair.call), {
      defines: ARGS,
      intents: CALL_INTENTS,
    }).intents;
    expect(portal!.intent).toEqual(call!.intent);
    expect(hashIntent(portal!.intent)).toEqual(hashIntent(call!.intent));
    expect(publishTx(portal!.intent, portalOn).data).toBe(publishTx(call!.intent, portalOn).data);
    // The reward is Base's USDC, escrowed where the program runs; the delivery is the
    // destination's.
    expect(BigInt(portal!.intent.reward.tokens[0]!.token)).toBe(usdcOf("base"));
    expect(BigInt(portal!.intent.route.tokens[0]!.token)).toBe(usdcOf(pair.destinations[0]!));
    expect(portal!.destination.slug).toBe(pair.destinations[0]);
  });

  it("a modifier is the option it names, for its intent alone", () => {
    const body = `{
      const held = USDC.balanceOf(ctx.self());
      USDC.transfer(RECIPIENT, held);
    }`;
    const portal = `function main() {
  Arbitrum.Portal.send([{ token: USDC, amount: 1010000 }, { native: 5 }])
    .prover(0x8888888888888888888888888888888888888888)
    .deadline(2000700000)
    .creator(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .salt(0x1234)
    .fee(7)
    .deadline(2000000600)
    .then(() => ${body});
}`;
    const call = `function main() {
  Arbitrum(() => ${body}, { tokens: [{ token: USDC, amount: 1000000 }] })
    .reward({ tokens: [{ token: USDC, amount: 1010000 }], nativeAmount: 5 });
}`;
    const options = {
      deadline: 2_000_000_600n,
      rewardDeadline: 2_000_700_000n,
      creator: "0x7777777777777777777777777777777777777777",
      prover: "0x8888888888888888888888888888888888888888",
      salt: `0x${"1234".padStart(64, "0")}`,
      executionFee: 7n,
    } as const;
    const withModifiers = record(() =>
      compileSauceProgram("base", portal, { defines: { RECIPIENT }, intents: INTENTS }),
    );
    const withOptions = record(() =>
      compileSauceProgram("base", call, { defines: { RECIPIENT }, intents: options }),
    );
    expect(withModifiers.compiles.map((c) => c.bytecode)).toEqual(
      withOptions.compiles.map((c) => c.bytecode),
    );
    const [intent] = withModifiers.result.intents;
    expect(intent!.intent).toEqual(withOptions.result.intents[0]!.intent);
    expect(intent!.intent.reward.nativeAmount).toBe(5n);
    expect(intent!.intent.route.calls.at(-1)!.value).toBe(7n);
  });

  it("defaults the deadlines from when the intent opens, as the compile says", () => {
    const openedAt = 1_900_000_000n;
    const [portal] = compileSauceProgram("base", bound(PAIRS[0]!.portal), {
      defines: ARGS,
      intents: { publisher: CREATOR, salt: SALT, openedAt },
    }).intents;
    const [call] = compileSauceProgram("base", bound(PAIRS[0]!.call), {
      defines: ARGS,
      intents: {
        creator: CREATOR,
        salt: SALT,
        deadline: openedAt + DEFAULT_FILL_WINDOW,
        rewardDeadline: openedAt + DEFAULT_FILL_WINDOW + DEFAULT_REFUND_WINDOW,
      },
    }).intents;
    expect(portal!.intent).toEqual(call!.intent);
    expect(portal!.captures).toEqual([]);
  });

  it("and, with no time given, from when the program opening it runs", () => {
    const program = compileSauceProgram("base", bound(PAIRS[0]!.portal), {
      defines: ARGS,
      intents: { publisher: CREATOR },
    });
    const [opened] = program.intents;
    expect(opened!.captures).toEqual([
      `ctx.timestamp() + ${DEFAULT_FILL_WINDOW}`,
      `the route's deadline + ${DEFAULT_REFUND_WINDOW}`,
    ]);
    expect(program.source).toContain(`(ctx.timestamp() + ${DEFAULT_FILL_WINDOW}n)`);
  });

  it("a deadline computed as the program runs is spliced in", () => {
    const [opened] = compileSauceProgram(
      "base",
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .deadline(ctx.timestamp() + 3600)
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
      { defines: { RECIPIENT }, intents: { publisher: CREATOR } },
    ).intents;
    expect(opened!.captures).toEqual([
      "ctx.timestamp() + 3600",
      `the route's deadline + ${DEFAULT_REFUND_WINDOW}`,
    ]);
  });

  it("every intent a program opens names its creator: none comes from above or the options", () => {
    const opens = (inner: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .then(() => {
      const held = USDC.balanceOf(ctx.self());
      Optimism.Portal.send({ token: USDC, amount: held })${inner}
        .receive({ token: USDT, amount: held })
        .then(() => { const left = USDT.balanceOf(ctx.self()); USDT.transfer(RECIPIENT, left); });
    });
}`;
    const fees: Record<string, bigint> = { arbitrum: 11n, optimism: 22n };
    const intents = {
      creator: CREATOR,
      publisher: CREATOR,
      openedAt: 1_900_000_000n,
      executionFee: (destination: CanonicalChain) => fees[destination.slug],
    };
    // The level above names one, and the compile gives both its options: the nested one is refused.
    expect(() =>
      compileSauceProgram("base", opens(""), { defines: { RECIPIENT }, intents }),
    ).toThrow(
      /an intent opened by a program needs `\.creator\(<address>\)` after `\.send\(\.\.\.\)`.*may be shared, so a refund there could go to anyone/,
    );

    // Named, it opens as its parent runs and pays its own chain's fee.
    const inner = 0x8888888888888888888888888888888888888888n;
    const { result, compiles: made } = record(() =>
      compileSauceProgram("base", opens(`\n        .creator(${hex(inner)})`), {
        defines: { RECIPIENT },
        intents,
      }),
    );
    const [outer] = result.intents;
    expect(outer!.intent.reward.creator.slice(-40)).toBe("77".repeat(20));
    expect(outer!.intent.route.calls.at(-1)!.value).toBe(11n);
    expect(outer!.captures).toEqual([]);
    const arbitrumProgram = made.find((c) => c.source.includes("ctx.timestamp()"))!;
    expect(arbitrumProgram.source).toContain(`(ctx.timestamp() + ${DEFAULT_FILL_WINDOW}n)`);
    expect(arbitrumProgram.source.toLowerCase()).toContain(inner.toString(16));
    expect(arbitrumProgram.source.toLowerCase()).not.toContain(CREATOR.slice(2));
    expect(arbitrumProgram.source.toLowerCase()).not.toContain("77".repeat(20));
  });

  it("a top-level intent a wallet publishes defaults to that wallet, and no other does", () => {
    const program = (creator: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })${creator}
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const [published] = compileSauceProgram("base", program(""), {
      defines: { RECIPIENT },
      intents: { publisher: CREATOR },
    }).intents;
    expect(published!.intent.reward.creator.slice(-40)).toBe(CREATOR.slice(2));
    // Named, it is its own.
    const [named] = compileSauceProgram(
      "base",
      program("\n    .creator(0x7777777777777777777777777777777777777777)"),
      { defines: { RECIPIENT }, intents: { publisher: CREATOR } },
    ).intents;
    expect(named!.intent.reward.creator.slice(-40)).toBe("77".repeat(20));
    // `creator` is the call form's: a Portal intent never takes it.
    expect(() =>
      compileSauceProgram("base", program(""), {
        defines: { RECIPIENT },
        intents: { creator: CREATOR },
      }),
    ).toThrow(/needs `\.creator\(<address>\)`/);
  });

  it("picks a random salt for each intent built, unless one is given", () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const saltOf = (intents: Record<string, unknown>, source = program) =>
      compileSauceProgram("base", source, { defines: { RECIPIENT }, intents }).intents[0]!.intent
        .route.salt;
    const first = saltOf({ openedAt: DEADLINE });
    const second = saltOf({ openedAt: DEADLINE });
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(saltOf({ openedAt: DEADLINE, salt: SALT })).toBe(SALT);
    expect(
      saltOf(
        { openedAt: DEADLINE, salt: SALT },
        program.replace(".then(", ".salt(0x1234)\n    .then("),
      ),
    ).toBe(`0x${"1234".padStart(64, "0")}`);
  });

  it("takes each item as an argument, as one list", () => {
    const opened = (send: string, receive: string) =>
      compileSauceProgram(
        "base",
        `function main() {
  Arbitrum.Portal.send(${send})
    .creator(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); USDT0.transfer(RECIPIENT, 5); });
}`,
        { defines: { RECIPIENT }, intents: { salt: SALT, openedAt: DEADLINE } },
      ).intents[0]!.intent;
    const items = "{ token: USDC, amount: 1010000 }, { native: 5 }";
    const delivered = "{ token: USDC, amount: 1000000 }, { token: USDT0, amount: 5 }";
    const asArguments = opened(items, delivered);
    expect(asArguments).toEqual(opened(`[${items}]`, `[${delivered}]`));
    expect(asArguments.reward.nativeAmount).toBe(5n);
    expect(asArguments.route.tokens).toHaveLength(2);
  });

  it(".receive() with no items: a body of token writes is delivered what it moves, a program nothing", () => {
    const tokenOnly = (receive: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const options = { defines: { RECIPIENT }, intents: { salt: SALT, openedAt: DEADLINE } };
    const [derived] = compileSauceProgram("base", tokenOnly(""), options).intents;
    const [named] = compileSauceProgram(
      "base",
      tokenOnly("{ token: USDC, amount: 1000000 }"),
      options,
    ).intents;
    expect(derived!.intent).toEqual(named!.intent);
    expect(BigInt(derived!.intent.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));

    const [program] = compileSauceProgram(
      "base",
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive()
    .fee(7)
    .then(() => { const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held); });
}`,
      options,
    ).intents;
    expect(program!.intent.route.tokens).toEqual([]);
    // The cook alone: nothing to move into the Pot first.
    expect(program!.intent.route.calls).toHaveLength(1);
  });

  it("reads a plain literal past 2^53 exactly, in an item and a modifier", () => {
    const [opened] = compileSauceProgram(
      "base",
      `function main() {
  Arbitrum.Portal.send({ token: WETH, amount: 1000000000000000001 }, { native: 10 ** 18 })
    .creator(0x1234567890abcdef1234567890abcdef12345678)
    .deadline(9007199254740993)
    .receive({ token: WETH, amount: 10 ** 18 + 1 })
    .deadline(9007199254740995)
    .salt(0xffffffffffffffffffff)
    .then(() => { WETH.transfer(RECIPIENT, 1000000000000000001); });
}`,
      { defines: { RECIPIENT } },
    ).intents;
    const { route, reward } = opened!.intent;
    expect(opened!.captures).toEqual([]);
    expect(reward.tokens[0]!.amount).toBe(1_000_000_000_000_000_001n);
    expect(reward.nativeAmount).toBe(10n ** 18n);
    expect(reward.creator.slice(-40)).toBe("1234567890abcdef1234567890abcdef12345678");
    expect(reward.deadline).toBe(9_007_199_254_740_993n);
    expect(route.tokens[0]!.amount).toBe(10n ** 18n + 1n);
    expect(route.deadline).toBe(9_007_199_254_740_995n);
    expect(route.salt).toBe(`0x${"ff".repeat(10).padStart(64, "0")}`);
  });

  it("folds arithmetic of known values, so an intent from main's bound arguments is fixed", () => {
    const [opened] = compileSauceProgram("base", bound(PAIRS[1]!.portal), {
      defines: ARGS,
      intents: INTENTS,
    }).intents;
    expect(opened!.captures).toEqual([]);
    expect(opened!.intent.route.tokens.map((t) => t.amount)).toEqual([990_000n]);
  });

  it("names a run-time amount as it is written", () => {
    const [opened] = compileSauceProgram("base", PAIRS[1]!.portal, {
      intents: INTENTS,
    }).intents;
    expect(opened!.captures).toEqual(["amount * 99 / 100", "recipient", "amount"]);
  });
});

describe("on the host", () => {
  const delivered = [{ token: hex(usdcOf("base")), amount: 1_000_000n }];
  const paid = { token: hex(usdcOf("ethereum")), amount: 1_010_000n };
  const FEE = 1_000n;
  const program =
    "function main() { USDC.transfer(0x6666666666666666666666666666666666666666, 1000000); }";
  /** The route options the host form means, given its modifiers. */
  const routeOptions = (deadline: bigint) => ({
    deadline,
    execution: { value: FEE },
    tokens: delivered,
    precalls: delivered.map((d) =>
      Token.transfer({ token: d.token, to: destinationPot("base"), amount: d.amount }).toCall(),
    ),
    creator: CREATOR,
  });

  it("builds the intent Base(body, options).reward(reward) builds, the Pot given its delivery", () => {
    const built = Base.Portal.send(paid)
      .source(Ethereum)
      .creator(CREATOR)
      .deadline(REWARD_DEADLINE + 1n)
      .receive(delivered)
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .then(program);
    const expected = Base(program, { ...routeOptions(DEADLINE), salt: SALT }).reward({
      source: "ethereum",
      creator: CREATOR,
      deadline: REWARD_DEADLINE + 1n,
      tokens: [paid],
    });

    expect(built.intent).toEqual(expected.intent);
    expect(built.hash()).toEqual(expected.hash());
    expect(built.encodeEVM()).toEqual(expected.encodeEVM());
    expect(built.sourceTxs()).toEqual(expected.sourceTxs());
    expect(built.publishCalldata()).toEqual(expected.publishCalldata());
    expect(built.source.slug).toBe("ethereum");
    expect(built.destination.slug).toBe("base");
    const published = decodeFunctionData({ abi: PortalABI, data: built.publishCalldata().data });
    expect(published.functionName).toBe("publish");
  });

  it("defaults the deadlines from now, the prover from the registry, the salt to random bytes", () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const built = Base.Portal.send(paid, { native: 3n })
      .source("ethereum")
      .creator(CREATOR)
      .receive(...delivered)
      .fee(FEE)
      .then(program);
    const after = BigInt(Math.floor(Date.now() / 1000));
    const { route, reward } = built.intent;
    expect(route.deadline >= before + DEFAULT_FILL_WINDOW).toBe(true);
    expect(route.deadline <= after + DEFAULT_FILL_WINDOW).toBe(true);
    expect(reward.deadline).toBe(route.deadline + DEFAULT_REFUND_WINDOW);
    expect(reward.nativeAmount).toBe(3n);
    expect(route.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(route.salt).not.toBe(`0x${"00".repeat(32)}`);
    const again = Base.Portal.send(paid).source("ethereum").creator(CREATOR).receive().fee(FEE);
    expect(again.then(program).intent.route.salt).not.toBe(again.then(program).intent.route.salt);
    const expected = Base(program, { ...routeOptions(route.deadline), salt: route.salt }).reward({
      source: "ethereum",
      creator: CREATOR,
      deadline: route.deadline + DEFAULT_REFUND_WINDOW,
      nativeAmount: 3n,
      tokens: [paid],
    });
    expect(built.intent).toEqual(expected.intent);
  });

  it("refuses what has no default in TypeScript, and a modifier given twice", () => {
    expect(() => Base.Portal.send(paid).receive(delivered).fee(FEE).then(program)).toThrow(
      /give `\.source\(\.\.\.\)` after `\.send\(\.\.\.\)`/,
    );
    expect(() =>
      Base.Portal.send(paid).source("ethereum").receive(delivered).fee(FEE).then(program),
    ).toThrow(/give `\.creator\(\.\.\.\)` after `\.send\(\.\.\.\)`: who may reclaim/);
    expect(() =>
      Base.Portal.send(paid).source("ethereum").creator(CREATOR).receive(delivered).then(program),
    ).toThrow(/give `\.fee\(\.\.\.\)` after `\.receive\(\.\.\.\)`/);
    const sent = Base.Portal.send(paid).creator(CREATOR) as unknown as {
      creator(address: string): unknown;
    };
    expect(() => sent.creator(CREATOR)).toThrow(/`\.creator\(\.\.\.\)` is given twice/);
  });

  it("takes a closure that opens the next intent, and items as arguments or one list", () => {
    const options = { source: "base" as const };
    const one = Ethereum.Portal.send(paid)
      .source(options.source)
      .creator(CREATOR)
      .receive(delivered[0]!)
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .then(() => {
        const held = USDC.balanceOf(ctx.self());
        Arbitrum.Portal.send({ token: USDC, amount: held })
          .creator(0x4444444444444444444444444444444444444444n)
          .receive({ token: USDC, amount: held })
          .salt(1n)
          .then(() => {
            USDC.transfer(0x6666666666666666666666666666666666666666n, held);
          });
      });
    const many = Ethereum.Portal.send([paid])
      .source(options.source)
      .creator(CREATOR)
      .receive(delivered)
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .then(() => {
        const held = USDC.balanceOf(ctx.self());
        Arbitrum.Portal.send({ token: USDC, amount: held })
          .creator(0x4444444444444444444444444444444444444444n)
          .receive({ token: USDC, amount: held })
          .salt(1n)
          .then(() => {
            USDC.transfer(0x6666666666666666666666666666666666666666n, held);
          });
      });
    expect(one.intent).toEqual(many.intent);
  });

  it("attaches a child with .nest(), as the route builder does", () => {
    const body = "function main() { return 1n; }";
    const child = (on: CanonicalChain) =>
      Ethereum.Portal.send(delivered)
        .source(on)
        .creator(CREATOR)
        .receive()
        .fee(FEE)
        .deadline(DEADLINE)
        .salt(SALT)
        .then(body);
    const nest = { requireCap: true, executionFee: 1_000n } as const;
    const built = Base.Portal.send(paid)
      .source("ethereum")
      .creator(CREATOR)
      .receive([])
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .nest(child, nest)
      .then(body);
    const expected = Base(body, { ...routeOptions(DEADLINE), tokens: [], precalls: [], salt: SALT })
      .nest(child, nest)
      .reward({
        source: "ethereum",
        creator: CREATOR,
        deadline: REWARD_DEADLINE,
        tokens: [paid],
      });

    expect(built.children).toHaveLength(1);
    expect(built.intents()).toEqual(expected.intents());
    expect(built.encodeEVM()).toEqual(expected.encodeEVM());
  });

  const pending = () =>
    Base.Portal.send(paid).source("ethereum").creator(CREATOR).receive(delivered).fee(FEE);

  it("refuses to be awaited: its then is the intent's", async () => {
    // TypeScript refuses the `await` itself (`routes-intent-portal-types.test.ts`); JavaScript, or
    // TypeScript told otherwise, reaches the `then`.
    await expect(
      (async () => {
        await (pending() as unknown);
      })(),
    ).rejects.toThrow(/is not a promise: `\.then\(\.\.\.\)` takes the intent's body/);
    await expect(Promise.resolve(pending() as unknown)).rejects.toThrow(/by `await`/);
    expect(() =>
      (pending().then as (...args: unknown[]) => unknown)(
        () => {},
        () => {},
      ),
    ).toThrow(/is not a promise/);
    expect(() => (pending().then as (...args: unknown[]) => unknown)()).toThrow(/is not a promise/);
  });
});

describe("what the lowering refuses", () => {
  const compile = (body: string) =>
    compileSauceProgram("base", `function main() {\n${body}\n}`, {
      defines: { RECIPIENT },
      intents: INTENTS,
    });
  const item = "{ token: USDC, amount: 1 }";
  const then = ".then(() => { USDC.transfer(RECIPIENT, 1); })";

  it.each([
    [`Arbitrum.Portal.send(${item}).receive(${item});`, /has no body\. Finish it with `\.then/],
    [`Arbitrum.Portal.send(${item}).creator(1);`, /stops before `\.receive\(\.\.\.\)`/],
    [
      `Arbitrum.Portal.send(${item})${then};`,
      /stops before `\.receive\(\.\.\.\)`, which every intent has.*`\.receive\(\)` for nothing/,
    ],
    [`Arbitrum.Portal.receive(${item}).send(${item})${then};`, /It starts with `\.send/],
    [`Arbitrum.Portal;`, /opens an intent on arbitrum/],
    [
      `const opened = Arbitrum.Portal.send(${item}).receive(${item})${then};`,
      /is a statement of its own/,
    ],
    [
      `Arbitrum.Portal.send(${item}).deadline(1).deadline(2).receive(${item})${then};`,
      /`\.deadline\(\.\.\.\)` is given twice after `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).salt(1).receive(${item})${then};`,
      /`\.salt\(\.\.\.\)` is not set after `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).creator(1)${then};`,
      /`\.creator\(\.\.\.\)` is not set after `\.receive\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).memo(1)${then};`,
      /`\.memo\(\.\.\.\)` is not a step of an intent/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item})${then}.salt(1);`,
      /`\.then\(\.\.\.\)` ends the intent/,
    ],
    [`Arbitrum.Portal.send(${item}).deadline().receive(${item})${then};`, /takes one argument/],
    [
      `const items = [${item}];\nArbitrum.Portal.send(items).receive(${item})${then};`,
      /`\.send\(\.\.\.\)` takes the reward written out in place/,
    ],
    [
      `Arbitrum.Portal.send([${item}], ${item}).receive(${item})${then};`,
      /takes each item as an argument, or one list of them on its own/,
    ],
    [
      `Arbitrum.Portal.send([]).receive(${item})${then};`,
      /`\.send\(\.\.\.\)` with nothing in it pays nothing/,
    ],
    [
      `Arbitrum.Portal.send().receive(${item})${then};`,
      /`\.send\(\.\.\.\)` with nothing in it pays nothing/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ native: 1 })${then};`,
      /`\.receive\(\.\.\.\)` names the tokens the solver delivers/,
    ],
    [
      `Arbitrum.Portal.send([{ native: 1 }, { native: 2 }]).receive(${item})${then};`,
      /names `\{ native \}` once/,
    ],
    [
      `const f = USDC.balanceOf(ctx.self());\nArbitrum.Portal.send(${item}).receive(${item}).fee(f)${then};`,
      /`\.fee\(\.\.\.\)` is the destination Kitchen's fee, which the intent is built with/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(1).then(() => {});`,
      /`\.receive\(\.\.\.\)` takes what the solver delivers written out in place/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).then(function () {});`,
      /`\.then\(\.\.\.\)` takes the intent's body, the code that runs on arbitrum/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDC })${then};`,
      /each entry of `\.receive\(\.\.\.\)` needs both `token` and `amount`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDT, amount: 1 })${then};`,
      /The delivery — what `\.receive\(\.\.\.\)` names — is what the solver brings to arbitrum/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 - 2 }).receive(${item})${then};`,
      /`\.send\(\.\.\.\)`'s `amount` is -1, outside an unsigned 256-bit word/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 / 0 }).receive(${item})${then};`,
      /divides by zero/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 > 0 }).receive(${item})${then};`,
      /uses `>`; an amount is integer arithmetic/,
    ],
  ])("%s", (body, message) => {
    expect(() => compile(body)).toThrow(message);
  });

  it("names .creator(...) when no creator is given, before compiling the body", () => {
    expect(() =>
      compileSauceProgram(
        "base",
        `function main() {\n  Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive({ token: USDC, amount: 1 }).then(() => { const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held); });\n}`,
        { defines: { RECIPIENT }, intents: { deadline: DEADLINE } },
      ),
    ).toThrow(
      /needs `\.creator\(<address>\)` after `\.send\(\.\.\.\)`: the address an unfilled intent's reward is refunded to/,
    );
  });
});
