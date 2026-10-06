/**
 * `Chain.Portal.send(reward)[modifiers].receive(delivery)[modifiers].then(body)`: each modifier is
 * the compile option it names, for its intent alone, and each default is the value it stands for,
 * byte for byte — the program's bytecode, which carries every level's intent, and each intent it
 * publishes.
 *
 * An intent a program opens is `@sauce/intents`' classes, which the compiler runs while it compiles:
 * the program encodes the intent as it runs. So what the program publishes is read where it runs —
 * on an anvil standing in for Base, with eco-routes' real Portal (`intent-anvil.ts`) — from the
 * `IntentPublished` the Portal logs, rebuilt in full and held to the hash it announces.
 *
 * The defaults: the route's deadline `DEFAULT_FILL_WINDOW` past when the intent opens — when the
 * compile says, else as the program runs, from the block's time — the reward's
 * `DEFAULT_REFUND_WINDOW` past that, the compile's salt, each destination's own Kitchen fee. The
 * creator has none: every intent a program opens names its own, but a top-level one a wallet
 * publishes itself (`publisher`).
 *
 * On the host: `Base.Portal.send(...)...then(body)` builds the intent `Base(body,
 * options).reward(reward)` builds, and its `then` refuses to be a promise's.
 *
 * And what the lowering refuses, by name: an expression that stops before its body, steps or
 * modifiers out of place or repeated, native coin delivered, a creator nobody named, a token the
 * destination lacks; and an amount's arithmetic that would revert.
 */
import { bytesToHex, decodeFunctionData, encodeAbiParameters, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { Arbitrum, Base, Ethereum } from "../src/index.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { DEFAULT_FILL_WINDOW, DEFAULT_REFUND_WINDOW } from "../src/routes/intent-defaults.js";
import type { IntentDefaults } from "../src/routes/intent-defaults.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import type { EntryValue } from "../src/routes/entry.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import type { Intent } from "../src/routes/types.js";
import { Token } from "../src/token/api.js";
import { describeEvm } from "./cli-anvil.js";
import { startIntentChain, type IntentChain } from "./intent-anvil.js";
import { freePort } from "./pools-anvil.js";

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
const low = (address: string): string => address.slice(-40).toLowerCase();

const compile = (program: string, intents: IntentDefaults, args?: readonly EntryValue[]) =>
  compileSauceProgram("base", program, {
    defines: { RECIPIENT },
    intents,
    ...(args === undefined ? {} : { args }),
  });

/** The same program: its bytecode, which carries every intent it opens and every body's. */
function expectSame(a: CompiledSauceProgram, b: CompiledSauceProgram): void {
  expect(bytesToHex(a.bytecode)).toBe(bytesToHex(b.bytecode));
}

/** Base opens Arbitrum, whose body measures what arrived and opens Optimism with it. */
const NESTED = `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99 / 100 }])
    .then(() => {
      USDC.transfer(recipient, amount * 99 / 100 / 2);
      Optimism.Portal.send({ token: USDC, amount: amount * 99 / 100 / 2 })
        .refundee(${CREATOR})
        .receive({ token: USDT0, amount: amount * 98 / 100 / 2 })
        .then(() => { USDT0.transfer(recipient, amount * 98 / 100 / 2); });
    });
}`;

describe("the intents a program opens, as compiled", () => {
  it("a modifier builds the same program as its option", () => {
    const program = (modifiers: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })${modifiers}
    .fee(1000)
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    expectSame(
      compile(program(`\n    .deadline(${DEADLINE})\n    .salt(${SALT})`), {}),
      compile(program(""), { deadline: DEADLINE, salt: SALT }),
    );
  });

  it("defaults the deadlines from when the intent opens, as the compile says", () => {
    const openedAt = 1_900_000_000n;
    const program = (modifiers: [string, string]) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })${modifiers[0]}
    .receive({ token: USDC, amount: 1000000 })${modifiers[1]}
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    expectSame(
      compile(program(["", ""]), { ...INTENTS, deadline: undefined, openedAt }),
      compile(
        program([
          `.deadline(${openedAt + DEFAULT_FILL_WINDOW + DEFAULT_REFUND_WINDOW})`,
          `.deadline(${openedAt + DEFAULT_FILL_WINDOW})`,
        ]),
        { ...INTENTS, deadline: undefined },
      ),
    );
  });

  it("every intent a program opens names its creator: none comes from above or the options", () => {
    const opens = (inner: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .then(() => {
      const held = USDC.balanceOf(ctx.self());
      Optimism.Portal.send({ token: USDC, amount: held })${inner}
        .receive({ token: USDT0, amount: held })
        .then(() => { const left = USDT0.balanceOf(ctx.self()); USDT0.transfer(RECIPIENT, left); });
    });
}`;
    // The level above names one and a wallet publishes the program: the nested one is refused.
    expect(() => compile(opens(""), { ...INTENTS, openedAt: 1_900_000_000n })).toThrow(
      /an intent opened by a program needs `\.refundee\(<address>\)` after `\.send\(\.\.\.\)`.*may be shared, so a refund there is one anyone can take/s,
    );
  });

  it("picks a random salt for each compile, unless one is given", () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const bytes = (intents: IntentDefaults) => bytesToHex(compile(program, intents).bytecode);
    const unsalted = { ...INTENTS, salt: undefined };
    expect(bytes(unsalted)).not.toBe(bytes(unsalted));
    expect(bytes(INTENTS)).toBe(bytes(INTENTS));
  });

  it("compiles each body for its chain, and names what it reads of the program around it", () => {
    const { bodies } = compile(NESTED, INTENTS);
    expect(bodies.map((body) => [body.destination.slug, body.path.length])).toEqual([
      ["optimism", 1],
      ["arbitrum", 0],
    ]);
    // The Arbitrum body reads main's two arguments; the Optimism one, nested in it, reads them of
    // the Arbitrum program, which carries them on.
    expect(bodies.find((body) => body.path.length === 0)!.captures).toEqual([
      "recipient",
      "amount",
    ]);
  });

  // Pending the compiler: compiling `main` for its arguments (`args`).
  it.failing(
    "folds arithmetic of known values, so an intent from main's bound arguments is fixed",
    () => {
      expect(compile(NESTED, INTENTS, [1_000_000n, hex(RECIPIENT)]).bodies[0]!.captures).toEqual(
        [],
      );
    },
  );

  // Pending the compiler: `await x;` as `x.then(() => { … })`.
  it.failing(
    "an `await` of the intent makes the statements after it its body, byte for byte",
    () => {
      const opened = `Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })`;
      const body = "const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held);";
      expectSame(
        compile(`function main() {\n  await ${opened};\n  ${body}\n}`, INTENTS),
        compile(`function main() {\n  ${opened}\n    .then(() => { ${body} });\n}`, INTENTS),
      );
    },
  );

  // Pending the compiler: `try`/`catch`, which a handler compiles to.
  it.failing("`.then(...).catch((e) => { … })` handles the body on its destination", () => {
    compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); })
    .catch((e) => { USDC.transfer(${CREATOR}, 1000000); });
}`,
      INTENTS,
    );
  });
});

describeEvm("the intents a program publishes", () => {
  let base: IntentChain;
  beforeAll(async () => {
    base = await startIntentChain("base", await freePort(), ["USDC", "WETH"]);
  }, 120_000);
  afterAll(async () => {
    await base?.stop();
  });

  const published = async (program: CompiledSauceProgram, args: Hex = "0x"): Promise<Intent[]> =>
    (await base.publish(program, args)).map(({ intent }) => intent);

  it("a modifier is the option it names, for its intent alone", async () => {
    const body = `{
      const held = USDC.balanceOf(ctx.self());
      USDC.transfer(RECIPIENT, held);
    }`;
    // The second intent names nothing, so it takes the options either way.
    const second = `
  Ethereum.Portal.send({ token: USDC, amount: 2020000 })
    .receive({ token: USDC, amount: 2000000 })
    .then(() => ${body});`;
    const [first, rest] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { native: 5 })
    .prover(0x8888888888888888888888888888888888888888)
    .deadline(2000700000)
    .refundee(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .salt(0x1234)
    .fee(7)
    .deadline(2000000600)
    .then(() => ${body});${second}
}`,
        INTENTS,
      ),
    );
    const [optioned] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { native: 5 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => ${body});
}`,
        {
          deadline: 2_000_000_600n,
          rewardDeadline: 2_000_700_000n,
          publisher: "0x7777777777777777777777777777777777777777",
          prover: "0x8888888888888888888888888888888888888888",
          salt: `0x${"1234".padStart(64, "0")}`,
          executionFee: 7n,
        },
      ),
    );
    expect(first).toEqual(optioned);
    expect(first!.reward.nativeAmount).toBe(5n);
    expect(first!.route.calls.at(-1)!.value).toBe(7n);
    expect(low(first!.reward.creator)).toBe("77".repeat(20));
    // The second keeps the options it was compiled with.
    expect(rest!.route.deadline).toBe(DEADLINE);
    expect(rest!.reward.deadline).toBe(REWARD_DEADLINE);
    expect(rest!.route.salt).toBe(SALT);
    expect(low(rest!.reward.creator)).toBe(CREATOR.slice(2));
    expect(rest!.route.calls.at(-1)!.value).toBe(1_000n);
  });

  it("defaults the deadlines from when the program opening it runs, with no time given", async () => {
    const program = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
      { publisher: CREATOR, salt: SALT, executionFee: 1_000n },
    );
    const before = (await base.local.publicClient.getBlock()).timestamp;
    const [opened] = await published(program);
    const at = (await base.local.publicClient.getBlock()).timestamp;
    expect(opened!.route.deadline).toBeGreaterThan(before + DEFAULT_FILL_WINDOW - 1n);
    expect(opened!.route.deadline).toBeLessThanOrEqual(at + DEFAULT_FILL_WINDOW);
    expect(opened!.reward.deadline).toBe(opened!.route.deadline + DEFAULT_REFUND_WINDOW);
  });

  it("a deadline computed as the program runs is written in", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .deadline(ctx.timestamp() + 3600)
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        { publisher: CREATOR, executionFee: 1_000n },
      ),
    );
    const at = (await base.local.publicClient.getBlock()).timestamp;
    expect(opened!.route.deadline).toBe(at + 3600n);
    expect(opened!.reward.deadline).toBe(at + 3600n + DEFAULT_REFUND_WINDOW);
  });

  it("an intent a body opens has its own creator, and pays its own chain's fee", async () => {
    const fees: Record<string, bigint> = { arbitrum: 11n, optimism: 22n };
    const inner = 0x8888888888888888888888888888888888888888n;
    const [outer] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .then(() => {
      const held = USDC.balanceOf(ctx.self());
      Optimism.Portal.send({ token: USDC, amount: held })
        .refundee(${hex(inner)})
        .receive({ token: USDT0, amount: held })
        .then(() => { const left = USDT0.balanceOf(ctx.self()); USDT0.transfer(RECIPIENT, left); });
    });
}`,
        {
          publisher: CREATOR,
          openedAt: 1_900_000_000n,
          executionFee: (destination: CanonicalChain) => fees[destination.slug],
        },
      ),
    );
    expect(low(outer!.reward.creator)).toBe("77".repeat(20));
    expect(outer!.route.calls.at(-1)!.value).toBe(11n);
    // The Arbitrum program, in the outer cook, carries the inner intent's creator and none else.
    const cook = outer!.route.calls.at(-1)!.data.toLowerCase();
    expect(cook).toContain(inner.toString(16));
    expect(cook).not.toContain(CREATOR.slice(2));
  });

  it("a top-level intent a wallet publishes defaults to that wallet, and no other does", async () => {
    const program = (creator: string) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })${creator}
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const [defaulted] = await published(compile(program(""), INTENTS));
    expect(low(defaulted!.reward.creator)).toBe(CREATOR.slice(2));
    const [named] = await published(
      compile(program("\n    .refundee(0x7777777777777777777777777777777777777777)"), INTENTS),
    );
    expect(low(named!.reward.creator)).toBe("77".repeat(20));
    // With no wallet publishing it, there is nobody to default to.
    expect(() => compile(program(""), { ...INTENTS, publisher: undefined })).toThrow(
      /needs `\.refundee\(<address>\)` after `\.send\(\.\.\.\)`: the address an unfilled intent's reward is refunded to/,
    );
  });

  it("takes the salt the compile was given, and a `.salt(...)` over it", async () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const [given] = await published(compile(program, INTENTS));
    expect(given!.route.salt).toBe(SALT);
    const [salted] = await published(
      compile(program.replace(".then(", ".salt(0x1234)\n    .then("), INTENTS),
    );
    expect(salted!.route.salt).toBe(`0x${"1234".padStart(64, "0")}`);
  });

  it("takes each item as an argument, as one list", async () => {
    const opened = async (send: string, receive: string) =>
      (
        await published(
          compile(
            `function main() {
  Arbitrum.Portal.send(${send})
    .refundee(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); USDT0.transfer(RECIPIENT, 5); });
}`,
            INTENTS,
          ),
        )
      )[0]!;
    const paid = "{ token: USDC, amount: 1010000 }, { token: WETH, amount: 5 }";
    const delivered = "{ token: USDC, amount: 1000000 }, { token: USDT0, amount: 5 }";
    const asArguments = await opened(`${paid}, { native: 5 }`, delivered);
    expect(asArguments).toEqual(await opened(`[${paid}], { native: 5 }`, `[${delivered}]`));
    expect(asArguments).toEqual(await opened(`[${paid}, { native: 5 }]`, `[${delivered}]`));
    expect(asArguments.reward.nativeAmount).toBe(5n);
    expect(asArguments.reward.tokens).toHaveLength(2);
    expect(asArguments.route.tokens).toHaveLength(2);
    // The delivery is the destination's token of each symbol.
    expect(BigInt(asArguments.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));
    expect(BigInt(asArguments.reward.tokens[0]!.token)).toBe(usdcOf("base"));
  });

  it(".receive() with no items: nothing is delivered, and the body's cook is the route's one call", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive()
    .fee(7)
    .then(() => { const held = USDC.balanceOf(ctx.self()); USDC.transfer(RECIPIENT, held); });
}`,
        { ...INTENTS, openedAt: DEADLINE },
      ),
    );
    expect(opened!.route.tokens).toEqual([]);
    expect(opened!.route.calls).toHaveLength(1);
    expect(opened!.route.calls[0]!.target.slice(-40)).toBe(low(destinationPot("arbitrum")));
  });

  it("delivered tokens move from the Executor into the destination's Pot, then the body cooks", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        INTENTS,
      ),
    );
    const [transfer, cook] = opened!.route.calls;
    expect(BigInt(transfer!.target)).toBe(usdcOf("arbitrum"));
    expect(transfer!.data).toBe(
      `0xa9059cbb${encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [destinationPot("arbitrum"), 1_000_000n],
      ).slice(2)}`,
    );
    expect(cook!.value).toBe(1_000n);
    expect(opened!.route.nativeAmount).toBe(1_000n);
  });

  it("reads a plain literal past 2^53 exactly, in an item and a modifier", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: WETH, amount: 1000000000000000001 }, { native: 10 ** 18 })
    .refundee(0x1234567890abcdef1234567890abcdef12345678)
    .deadline(9007199254740993)
    .receive({ token: WETH, amount: 10 ** 18 + 1 })
    .deadline(9007199254740995)
    .salt(0xffffffffffffffffffff)
    .fee(1000)
    .then(() => { WETH.transfer(RECIPIENT, 1000000000000000001); });
}`,
        {},
      ),
    );
    const { route, reward } = opened!;
    expect(reward.tokens[0]!.amount).toBe(1_000_000_000_000_000_001n);
    expect(reward.nativeAmount).toBe(10n ** 18n);
    expect(low(reward.creator)).toBe("1234567890abcdef1234567890abcdef12345678");
    expect(reward.deadline).toBe(9_007_199_254_740_993n);
    expect(route.tokens[0]!.amount).toBe(10n ** 18n + 1n);
    expect(route.deadline).toBe(9_007_199_254_740_995n);
    expect(route.salt).toBe(`0x${"ff".repeat(10).padStart(64, "0")}`);
  });

  it("writes main's arguments where the intent takes them, the body's among them", async () => {
    const program = compile(NESTED, INTENTS);
    const [opened] = await published(
      program,
      encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [1_000_000n, hex(RECIPIENT)]),
    );
    expect(opened!.route.tokens.map((t) => t.amount)).toEqual([990_000n]);
    expect(opened!.reward.tokens.map((t) => t.amount)).toEqual([1_000_000n]);
    // The reward is Base's USDC, escrowed where the program runs; the delivery is Arbitrum's.
    expect(BigInt(opened!.reward.tokens[0]!.token)).toBe(usdcOf("base"));
    expect(BigInt(opened!.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));
    expect(opened!.destination).toBe(42161n);
    // The body's arguments, appended to its program: main's `recipient` and `amount`, in order.
    const cook = opened!.route.calls.at(-1)!.data.toLowerCase();
    expect(cook).toContain(
      `${RECIPIENT.toString(16).padStart(64, "0")}${1_000_000n.toString(16).padStart(64, "0")}`,
    );
  });

  it("publishAndFund approves the Portal and has it pull the reward", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { token: USDC, amount: 7 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        { ...INTENTS, fundVia: "publishAndFund" },
      ),
    );
    expect(opened!.reward.tokens.map((t) => t.amount)).toEqual([1_010_000n, 7n]);
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
      .refundee(CREATOR)
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
      .refundee(CREATOR)
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
    const again = Base.Portal.send(paid).source("ethereum").refundee(CREATOR).receive().fee(FEE);
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
    ).toThrow(/give `\.refundee\(\.\.\.\)` after `\.send\(\.\.\.\)`: who may reclaim/);
    expect(() =>
      Base.Portal.send(paid).source("ethereum").refundee(CREATOR).receive(delivered).then(program),
    ).toThrow(/give `\.fee\(\.\.\.\)` after `\.receive\(\.\.\.\)`/);
    const sent = Base.Portal.send(paid).refundee(CREATOR) as unknown as {
      refundee(address: string): unknown;
    };
    expect(() => sent.refundee(CREATOR)).toThrow(/`\.refundee\(\.\.\.\)` is given twice/);
  });

  it("refuses a handler: the host builds the body alone", () => {
    const built = Base.Portal.send(paid)
      .source("ethereum")
      .refundee(CREATOR)
      .receive(delivered)
      .fee(FEE)
      .then(program);
    expect(() => built.catch(() => {})).toThrow(TypeError);
  });

  it("takes a closure that opens the next intent, and items as arguments or one list", () => {
    const one = Ethereum.Portal.send(paid)
      .source("base")
      .refundee(CREATOR)
      .receive(delivered[0]!)
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .then(() => {
        const held = USDC.balanceOf(ctx.self());
        Arbitrum.Portal.send({ token: USDC, amount: held })
          .refundee(0x4444444444444444444444444444444444444444n)
          .receive({ token: USDC, amount: held })
          .salt(1n)
          .fee(1n)
          .then(() => {
            USDC.transfer(0x6666666666666666666666666666666666666666n, held);
          });
      });
    const many = Ethereum.Portal.send([paid])
      .source("base")
      .refundee(CREATOR)
      .receive(delivered)
      .fee(FEE)
      .deadline(DEADLINE)
      .salt(SALT)
      .then(() => {
        const held = USDC.balanceOf(ctx.self());
        Arbitrum.Portal.send({ token: USDC, amount: held })
          .refundee(0x4444444444444444444444444444444444444444n)
          .receive({ token: USDC, amount: held })
          .salt(1n)
          .fee(1n)
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
        .refundee(CREATOR)
        .receive()
        .fee(FEE)
        .deadline(DEADLINE)
        .salt(SALT)
        .then(body);
    const nest = { requireCap: true, executionFee: 1_000n } as const;
    const built = Base.Portal.send(paid)
      .source("ethereum")
      .refundee(CREATOR)
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
    Base.Portal.send(paid).source("ethereum").refundee(CREATOR).receive(delivered).fee(FEE);

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

  it("refuses the refund address's old name, naming the steps there: it is `.refundee(...)`", () => {
    const old = "creator"; // the step `.refundee(...)` replaced
    expect(
      refused(`Arbitrum.Portal.send(${item}).${old}(${CREATOR}).receive(${item})${then};`),
    ).toThrow(
      `\`${old}\` is not a member of an instance of \`Intent\`: after ` +
        "`.send(...)` its steps are `.refundee(...)`, `.deadline(...)`, `.prover(...)` and " +
        "`.receive(...)`",
    );
    // At the Portal, before the reward, and after the body.
    expect(refused(`Arbitrum.Portal.${old}(${CREATOR});`)).toThrow(
      "a chain's `Portal` takes one step, `.send(...)`",
    );
    expect(refused(`Arbitrum.Portal.send(${item}).receive(${item})${then}.${old}(1);`)).toThrow(
      "after `.then(...)` its one step is `.catch(...)`",
    );
  });

  // Pending the compiler: a `.catch()` handler's `(e)`.
  it.failing("refuses a second `.catch(...)`", () => {
    expect(
      refused(
        `Arbitrum.Portal.send(${item}).receive(${item})${then}.catch((e) => {}).catch((e) => {});`,
      ),
    ).toThrow(/`\.catch\(\.\.\.\)` is not a step after `\.catch\(\.\.\.\)`/);
  });

  it("a `const` holding the intent opens it where its block ends", () => {
    expectSame(
      compile(
        `function main() {\n  const opened = Arbitrum.Portal.send(${item}).receive(${item})${then};\n}`,
        INTENTS,
      ),
      compile(
        `function main() {\n  Arbitrum.Portal.send(${item}).receive(${item})${then};\n}`,
        INTENTS,
      ),
    );
  });

  it.each([
    [`Arbitrum.Portal.send(${item}).receive(${item});`, /has no body\. Finish it with `\.then/],
    [`Arbitrum.Portal.send(${item}).refundee(1);`, /stops before `\.receive\(\.\.\.\)`/],
    [
      `Arbitrum.Portal.send(${item})${then};`,
      /stops before `\.receive\(\.\.\.\)`, which every intent has.*`\.receive\(\)` for nothing/,
    ],
    [
      `Arbitrum.Portal.receive(${item}).send(${item})${then};`,
      /`receive` is not a member of `Arbitrum\.Portal`: a chain's `Portal` takes one step/,
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
      /`\.salt\(\.\.\.\)` is not a step after `\.send\(\.\.\.\)`: its steps are `\.refundee/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).refundee(1)${then};`,
      /`\.refundee\(\.\.\.\)` is not a step after `\.receive\(\.\.\.\)`: its steps are `\.deadline/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).memo(1)${then};`,
      /`memo` is not a member of .*after `\.receive\(\.\.\.\)` its steps are/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item})${then}.salt(1);`,
      /`\.salt\(\.\.\.\)` is not a step after `\.then\(\.\.\.\)`: its one step is `\.catch/,
    ],
    [
      `Arbitrum.Portal.send(${item}).deadline().receive(${item})${then};`,
      /`\.deadline\(\.\.\.\)` takes the deadline, in Unix seconds/,
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
      `Arbitrum.Portal.send(${item}).receive({ token: USDC })${then};`,
      /each item `\.receive\(\.\.\.\)` takes is `\{ token, amount \}`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDT, amount: 1 })${then};`,
      /a token `\.receive\(\.\.\.\)` names is arbitrum's of the same symbol, and arbitrum registers no token of that symbol/,
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
      `Solana.Portal.send(${item}).receive(${item})${then};`,
      /an intent a program opens runs its body on an EVM chain: solana/,
    ],
  ])("%s", (body, message) => {
    expect(refused(body)).toThrow(message);
  });
});
