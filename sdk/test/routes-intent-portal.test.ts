/**
 * `Chain.Portal.send(reward)[modifiers].receive(delivery)[modifiers].then(body)`: each modifier is
 * the compile option it names, for its intent alone, and each default is the value it stands for,
 * byte for byte — the program's bytecode, which carries every level's `publish` calldata, and each
 * intent it opens.
 *
 * The defaults: the route's deadline `DEFAULT_FILL_WINDOW` past when the intent opens — when the
 * compile says, else as the program runs, from the block's time (a stamp) — the reward's
 * `DEFAULT_REFUND_WINDOW` past that, a random salt, each destination's own Kitchen fee. The creator
 * has none: every intent a program opens names its own, but a top-level one a wallet publishes
 * itself (`publisher`).
 *
 * On the host: `Base.Portal.send(...)...then(body)` builds the intent `Base(body,
 * options).reward(reward)` builds, and its `then` refuses to be a promise's.
 *
 * And what the lowering refuses, by name: an expression that stops before its body, steps or
 * modifiers out of place or repeated, native coin delivered, a fee computed as it runs, a creator
 * nobody named, a value that is not one; and an amount's arithmetic that would revert.
 */
import { bytesToHex, decodeFunctionData, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { Arbitrum, Base, Ethereum } from "../src/index.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { DEFAULT_FILL_WINDOW, DEFAULT_REFUND_WINDOW } from "../src/routes/intent-defaults.js";
import type { IntentSugarDefaults } from "../src/routes/intent-host.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { publishTx } from "../src/routes/portal.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { Token } from "../src/token/api.js";

const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const DEADLINE = 2_000_000_000n;
/** The reward's deadline the Portal form defaults to, given the route's. */
const REWARD_DEADLINE = DEADLINE + DEFAULT_REFUND_WINDOW;
const SALT = `0x${"5a".repeat(32)}` as const;
/** A top-level intent's creator is the wallet publishing it; one salt, since the default is
 *  random. */
const INTENTS = {
  deadline: DEADLINE,
  publisher: CREATOR,
  salt: SALT,
  executionFee: 1_000n,
} as const;
const usdcOf = (slug: string): bigint => registryTokenAddress(requireChain(slug), "USDC")!;
const hex = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

const compile = (program: string, intents: IntentSugarDefaults, args?: readonly bigint[]) =>
  compileSauceProgram("base", program, {
    defines: { RECIPIENT },
    intents,
    ...(args === undefined ? {} : { args }),
  });

/** The same program: its bytecode, every level's within it, and each intent it opens. */
function expectSame(a: CompiledSauceProgram, b: CompiledSauceProgram): void {
  expect(bytesToHex(a.bytecode)).toBe(bytesToHex(b.bytecode));
  expect(a.intents).toEqual(b.intents);
}

/** Base opens Arbitrum, whose body measures what arrived and opens Optimism with it. */
const NESTED = `function main(amount: Uint256, recipient: Address) {
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
}`;

describe("the intents a program opens", () => {
  const portalOn = { portal: ecoRoutesPortal(requireChain("base")) };

  it("a modifier is the option it names, for its intent alone", () => {
    const body = `{
      const held = USDC.balanceOf(ctx.self());
      USDC.transfer(RECIPIENT, held);
    }`;
    // The second intent names nothing, so it takes the options either way.
    const second = `
  Ethereum.Portal.send({ token: USDC, amount: 2020000 })
    .receive({ token: USDC, amount: 2000000 })
    .then(() => ${body});`;
    const withModifiers = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { native: 5 })
    .prover(0x8888888888888888888888888888888888888888)
    .deadline(2000700000)
    .creator(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .salt(0x1234)
    .fee(7)
    .deadline(2000000600)
    .then(() => ${body});${second}
}`,
      INTENTS,
    );
    const options = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { native: 5 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => ${body});${second}
}`,
      {
        deadline: 2_000_000_600n,
        rewardDeadline: 2_000_700_000n,
        publisher: "0x7777777777777777777777777777777777777777",
        prover: "0x8888888888888888888888888888888888888888",
        salt: `0x${"1234".padStart(64, "0")}`,
        executionFee: 7n,
      },
    );
    const [first, rest] = withModifiers.intents;
    expect(first!.intent).toEqual(options.intents[0]!.intent);
    expect(first!.intent.reward.nativeAmount).toBe(5n);
    expect(first!.intent.route.calls.at(-1)!.value).toBe(7n);
    expect(first!.intent.reward.creator.slice(-40)).toBe("77".repeat(20));
    // The second keeps the options it was compiled with.
    expect(rest!.intent.route.deadline).toBe(DEADLINE);
    expect(rest!.intent.reward.deadline).toBe(REWARD_DEADLINE);
    expect(rest!.intent.route.salt).toBe(SALT);
    expect(rest!.intent.reward.creator.slice(-40)).toBe(CREATOR.slice(2));
    expect(rest!.intent.route.calls.at(-1)!.value).toBe(1_000n);
  });

  it("a modifier builds the same program and publish calldata as its option", () => {
    const program = (modifiers: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })${modifiers}
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const modified = compile(program(`\n    .deadline(${DEADLINE})\n    .salt(${SALT})`), {});
    const optioned = compile(program(""), { deadline: DEADLINE, salt: SALT });
    expectSame(modified, optioned);
    const [opened] = modified.intents;
    expect(hashIntent(opened!.intent)).toEqual(hashIntent(optioned.intents[0]!.intent));
    expect(publishTx(opened!.intent, portalOn).data).toBe(
      publishTx(optioned.intents[0]!.intent, portalOn).data,
    );
  });

  it("defaults the deadlines from when the intent opens, as the compile says", () => {
    const openedAt = 1_900_000_000n;
    const program = (modifiers: [string, string]) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })${modifiers[0]}
    .receive({ token: USDC, amount: 1000000 })${modifiers[1]}
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const defaulted = compile(program(["", ""]), { publisher: CREATOR, salt: SALT, openedAt });
    const explicit = compile(
      program([
        `.deadline(${openedAt + DEFAULT_FILL_WINDOW + DEFAULT_REFUND_WINDOW})`,
        `.deadline(${openedAt + DEFAULT_FILL_WINDOW})`,
      ]),
      { publisher: CREATOR, salt: SALT },
    );
    expectSame(defaulted, explicit);
    expect(defaulted.intents[0]!.captures).toEqual([]);
  });

  it("and, with no time given, from when the program opening it runs", () => {
    const program = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
      { publisher: CREATOR, salt: SALT },
    );
    const [opened] = program.intents;
    expect(opened!.captures).toEqual([
      `ctx.timestamp() + ${DEFAULT_FILL_WINDOW}`,
      `the route's deadline + ${DEFAULT_REFUND_WINDOW}`,
    ]);
    // `@sauce/intents` writes them as the program runs: the routes-intent-chains e2e suite reads
    // them back from the Portal.
    expect(opened!.intent.route.deadline).not.toBe(opened!.intent.reward.deadline);
  });

  it("a deadline computed as the program runs is spliced in", () => {
    const [opened] = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .deadline(ctx.timestamp() + 3600)
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
      { publisher: CREATOR },
    ).intents;
    expect(opened!.captures).toEqual([
      "the route's `.deadline(...)`",
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
      publisher: CREATOR,
      openedAt: 1_900_000_000n,
      executionFee: (destination: CanonicalChain) => fees[destination.slug],
    };
    // The level above names one and a wallet publishes the program: the nested one is refused.
    expect(() => compile(opens(""), intents)).toThrow(
      /an intent opened by a program needs `\.creator\(<address>\)` after `\.send\(\.\.\.\)`.*may be shared, so a refund there is one anyone can take/s,
    );

    // Named, it opens as its parent runs, with its own creator, and pays its own chain's fee.
    const inner = 0x8888888888888888888888888888888888888888n;
    const [outer] = compile(opens(`\n        .creator(${hex(inner)})`), intents).intents;
    expect(outer!.intent.reward.creator.slice(-40)).toBe("77".repeat(20));
    expect(outer!.intent.route.calls.at(-1)!.value).toBe(11n);
    expect(outer!.captures).toEqual([]);
    // The Arbitrum program, in the outer cook, carries the inner intent's creator and none else.
    const cook = outer!.intent.route.calls.at(-1)!.data.toLowerCase();
    expect(cook).toContain(inner.toString(16));
    expect(cook).not.toContain(CREATOR.slice(2));
  });

  it("a top-level intent a wallet publishes defaults to that wallet, and no other does", () => {
    const program = (creator: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })${creator}
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const [published] = compile(program(""), { publisher: CREATOR }).intents;
    expect(published!.intent.reward.creator.slice(-40)).toBe(CREATOR.slice(2));
    // Named, it is its own.
    const [named] = compile(program("\n    .creator(0x7777777777777777777777777777777777777777)"), {
      publisher: CREATOR,
    }).intents;
    expect(named!.intent.reward.creator.slice(-40)).toBe("77".repeat(20));
    // With no wallet publishing it, there is nobody to default to.
    expect(() => compile(program(""), { deadline: DEADLINE })).toThrow(
      /needs `\.creator\(<address>\)` after `\.send\(\.\.\.\)`: the address an unfilled intent's reward is refunded to/,
    );
  });

  it("picks a random salt for each intent built, unless one is given", () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const saltOf = (intents: IntentSugarDefaults, source = program) =>
      compile(source, intents).intents[0]!.intent.route.salt;
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
      compile(
        `function main() {
  Arbitrum.Portal.send(${send})
    .creator(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); USDT0.transfer(RECIPIENT, 5); });
}`,
        { salt: SALT, openedAt: DEADLINE },
      ).intents[0]!.intent;
    const paid = "{ token: USDC, amount: 1010000 }, { token: WETH, amount: 5 }";
    const delivered = "{ token: USDC, amount: 1000000 }, { token: USDT0, amount: 5 }";
    const asArguments = opened(`${paid}, { native: 5 }`, delivered);
    // A list is one type throughout, so the native coin stays an argument of its own.
    expect(asArguments).toEqual(opened(`[${paid}], { native: 5 }`, `[${delivered}]`));
    expect(asArguments.reward.nativeAmount).toBe(5n);
    expect(asArguments.reward.tokens).toHaveLength(2);
    expect(asArguments.route.tokens).toHaveLength(2);
  });

  it(".receive() with no items: a body of token writes is delivered what it moves, a program nothing", () => {
    const tokenOnly = (receive: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const intents = { salt: SALT, openedAt: DEADLINE };
    const derived = compile(tokenOnly(""), intents);
    const named = compile(tokenOnly("{ token: USDC, amount: 1000000 }"), intents);
    expectSame(derived, named);
    expect(BigInt(derived.intents[0]!.intent.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));

    const [program] = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .creator(${CREATOR})
    .receive()
    .fee(7)
    .then(() => { const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held); });
}`,
      intents,
    ).intents;
    expect(program!.intent.route.tokens).toEqual([]);
    // The cook alone: nothing to move into the Pot first.
    expect(program!.intent.route.calls).toHaveLength(1);
  });

  it("reads a plain literal past 2^53 exactly, in an item and a modifier", () => {
    const [opened] = compile(
      `function main() {
  Arbitrum.Portal.send({ token: WETH, amount: 1000000000000000001 }, { native: 10 ** 18 })
    .creator(0x1234567890abcdef1234567890abcdef12345678)
    .deadline(9007199254740993)
    .receive({ token: WETH, amount: 10 ** 18 + 1 })
    .deadline(9007199254740995)
    .salt(0xffffffffffffffffffff)
    .then(() => { WETH.transfer(RECIPIENT, 1000000000000000001); });
}`,
      {},
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
    const [opened] = compile(NESTED, INTENTS, [1_000_000n, hex(RECIPIENT)]).intents;
    expect(opened!.captures).toEqual([]);
    expect(opened!.intent.route.tokens.map((t) => t.amount)).toEqual([990_000n]);
    // The reward is Base's USDC, escrowed where the program runs; the delivery is Arbitrum's.
    expect(BigInt(opened!.intent.reward.tokens[0]!.token)).toBe(usdcOf("base"));
    expect(BigInt(opened!.intent.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));
    expect(opened!.destination.slug).toBe("arbitrum");
  });

  it("an `await` of the intent makes the statements after it its body, byte for byte", () => {
    const opened = `Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })`;
    for (const body of [
      // Token writes alone: recorded, the route's own calls.
      "USDC.transfer(RECIPIENT, 1000000);",
      // A program, measuring what arrived.
      "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held);",
    ]) {
      expectSame(
        compile(`function main() {\n  await ${opened};\n  ${body}\n}`, INTENTS),
        compile(`function main() {\n  ${opened}\n    .then(() => { ${body} });\n}`, INTENTS),
      );
    }
    // At a script's top level, where a TypeScript editor takes an `await` as it is.
    expectSame(
      compile(`await ${opened};\nUSDC.transfer(RECIPIENT, 1000000);`, INTENTS),
      compile(`${opened}\n  .then(() => { USDC.transfer(RECIPIENT, 1000000); });`, INTENTS),
    );
    // Two `await`s are an intent opened in the body of the one before.
    const awaited = `function main(amount: Uint256, recipient: Address) {
  await Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99 / 100 }]);
  USDC.transfer(recipient, amount * 99 / 100 / 2);
  await Optimism.Portal.send({ token: USDC, amount: amount * 99 / 100 / 2 })
    .creator(${CREATOR})
    .receive({ token: USDT, amount: amount * 98 / 100 / 2 });
  USDT.transfer(recipient, amount * 98 / 100 / 2);
}`;
    expectSame(compile(awaited, INTENTS), compile(NESTED, INTENTS));
  });

  it("names each run-time value by its name, or by what it is in the intent", () => {
    const [opened] = compile(NESTED, INTENTS).intents;
    // In the order the intent is built: the delivery, the body's captures, the reward.
    expect(opened!.captures).toEqual(["the delivery amount", "recipient", "amount"]);
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

  it("refuses a handler: the host builds the body alone", () => {
    const built = Base.Portal.send(paid)
      .source("ethereum")
      .creator(CREATOR)
      .receive(delivered)
      .fee(FEE)
      .then(program);
    expect(() => built.catch(() => {})).toThrow(TypeError);
  });

  it("takes a closure that opens the next intent, and items as arguments or one list", () => {
    const one = Ethereum.Portal.send(paid)
      .source("base")
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
      .source("base")
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
    const body = "function main() { return 1; }";
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
  const refused = (body: string) => () => compile(`function main() {\n${body}\n}`, INTENTS);
  const item = "{ token: USDC, amount: 1 }";
  const then = ".then(() => { USDC.transfer(RECIPIENT, 1); })";

  it.each([
    [`Arbitrum.Portal.send(${item}).receive(${item});`, /has no body\. Finish it with `\.then/],
    [`Arbitrum.Portal.send(${item}).creator(1);`, /stops before `\.receive\(\.\.\.\)`/],
    [
      `Arbitrum.Portal.send(${item})${then};`,
      /stops before `\.receive\(\.\.\.\)`, which every intent has.*`\.receive\(\)` for nothing/,
    ],
    [`Arbitrum.Portal.receive(${item}).send(${item})${then};`, /`Portal` has no method `receive`/],
    [
      `const opened = Arbitrum.Portal.send(${item}).receive(${item})${then};`,
      /produces no value, so its result can't be used as one/,
    ],
    [
      `Arbitrum.Portal.send(${item}).deadline(1).deadline(2).receive(${item})${then};`,
      /`\.deadline\(\.\.\.\)` is given twice after `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).salt(1).salt(2)${then};`,
      /`\.salt\(\.\.\.\)` is given twice after `\.receive\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).salt(1).receive(${item})${then};`,
      /`Sent` has no method `salt`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).creator(1)${then};`,
      /`Received` has no method `creator`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).memo(1)${then};`,
      /`Received` has no method `memo`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item})${then}.salt(1);`,
      /`Opened` has no method `salt`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item})${then}.catch((e) => {}).catch((e) => {});`,
      /`\.catch\(\)` on something other than an external contract call/,
    ],
    [
      `Arbitrum.Portal.send(${item}).deadline().receive(${item})${then};`,
      /`Sent\.deadline` takes 1 argument\(s\), but this call passes 0/,
    ],
    [
      `const items = [${item}];\nArbitrum.Portal.send(items).receive(${item})${then};`,
      /a value the host binds at this site must be a number, an address, a bool or a literal of them/,
    ],
    [
      `Arbitrum.Portal.send().receive(${item})${then};`,
      /`\.send\(\.\.\.\)` must offer something: a token amount, or `\{ native: amount \}`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ native: 1 })${then};`,
      /`\.receive\(\.\.\.\)` names tokens: the native coin is paid with `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send([{ native: 1 }, { native: 2 }]).receive(${item})${then};`,
      /`\.send\(\.\.\.\)` names its native amount once/,
    ],
    [
      `const f = USDC.balanceOf(ctx.self());\nArbitrum.Portal.send(${item}).receive(${item}).fee(f)${then};`,
      /`\.fee\(\.\.\.\)` is the destination Kitchen's fee, which the intent is built with/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(1)${then};`,
      /each item `\.receive\(\.\.\.\)` takes is `\{ token, amount \}`, or a list of token amounts(?! must)/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDC })${then};`,
      /each item `\.receive\(\.\.\.\)` takes is `\{ token, amount \}`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDT, amount: 1 })${then};`,
      /`USDT` is not a token or protocol on arbitrum\. Did you mean `USDC` or `USDT0`\?/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 - 2 }).receive(${item})${then};`,
      /constant `-` expression overflows 256 bits/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 / 0 }).receive(${item})${then};`,
      /constant `\/` expression divides by zero/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 > 0 }).receive(${item})${then};`,
      /the reward amount is a `bool`: an intent's values are amounts, addresses and seconds/,
    ],
  ])("%s", (body, message) => {
    expect(refused(body)).toThrow(message);
  });
});
