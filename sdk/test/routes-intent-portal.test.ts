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
 * creator has none: every intent names its own, `.refundee(...)`.
 *
 * On the host: `Base.Portal.send(...).source(chain)...then(body)` writes the statement a program
 * opens that intent with and compiles it for the source chain — the same program as the statement
 * written in a file — and its cook publishes the same intent from a Pot there; its `then` refuses to
 * be a promise's.
 *
 * And what the lowering refuses, by name: an expression that stops before its body, steps or
 * modifiers out of place or repeated, native coin delivered, a creator nobody named, a token the
 * destination lacks; and an amount's arithmetic that would revert.
 */
import {
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { Arbitrum, Base, Ethereum } from "../src/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { DEFAULT_FILL_WINDOW, DEFAULT_REFUND_WINDOW } from "../src/routes/intent-defaults.js";
import type { IntentDefaults } from "../src/routes/intent-defaults.js";
import { hashIntent } from "../src/routes/encode.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { predictIntentVault } from "../src/routes/portal.js";
import type { EntryValue } from "../src/routes/entry.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import type { Intent } from "../src/routes/types.js";
import { describeEvm, FEE as KITCHEN_FEE } from "./cli-anvil.js";
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

/** The salt an intent given none takes: the compile's, mixed with the count of intents the
 *  transaction has opened, this one included. */
const defaultSalt = (base: Hex, opened: bigint): Hex =>
  keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(base), opened]),
  );

/** The same program: its bytecode, which carries every intent it opens and every body's. */
function expectSame(a: CompiledSauceProgram, b: CompiledSauceProgram): void {
  expect(bytesToHex(a.bytecode)).toBe(bytesToHex(b.bytecode));
}

/** Base opens Arbitrum, whose body measures what arrived and opens Optimism with it. */
const NESTED = `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .refundee(${CREATOR})
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
    // The salt is not among them: an option's is a default, which each intent mixes with how many
    // the transaction has opened, while a modifier's is used as written.
    expectSame(
      compile(program(`\n    .deadline(${DEADLINE})`), { salt: SALT }),
      compile(program(""), { deadline: DEADLINE, salt: SALT }),
    );
  });

  it("defaults the deadlines from when the intent opens, as the compile says", () => {
    const openedAt = 1_900_000_000n;
    const program = (modifiers: [string, string]) => `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})${modifiers[0]}
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
    // The level above names one: the nested one is refused all the same.
    expect(() => compile(opens(""), { ...INTENTS, openedAt: 1_900_000_000n })).toThrow(
      /an intent needs `\.refundee\(<address>\)` after `\.send\(\.\.\.\)`.*may be shared, so a refund there is one anyone can take/s,
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

  // Pending the compiler's bare names passed to a call it runs (the v12 #557 port): Base has no
  // USDT0, and the class reads the symbol on the destination, where `Token(<address>)` works today.
  it.failing("a delivery token only the destination has, by its bare symbol", () => {
    const usdt0 = hex(registryTokenAddress(requireChain("arbitrum"), "USDT0")!);
    const program = (token: string) => `function main(amount: Uint256) {
  Arbitrum.Portal.send({ token: USDC, amount })
    .refundee(${CREATOR})
    .receive({ token: ${token}, amount })
    .fee(0)
    .then(() => { USDT0.transfer(RECIPIENT, amount); });
}`;
    expectSame(compile(program("USDT0"), INTENTS), compile(program(`Token(${usdt0})`), INTENTS));
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
    .refundee(${CREATOR})
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
    .refundee(${CREATOR})
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
    // The second names only its refundee, so it takes the options either way.
    const second = `
  Ethereum.Portal.send({ token: USDC, amount: 2020000 })
    .refundee(${CREATOR})
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
    .refundee(0x7777777777777777777777777777777777777777)
    .receive({ token: USDC, amount: 1000000 })
    .salt(0x1234)
    .then(() => ${body});
}`,
        {
          deadline: 2_000_000_600n,
          rewardDeadline: 2_000_700_000n,
          prover: "0x8888888888888888888888888888888888888888",
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
    // The first intent was given its salt, so the second is the transaction's first default one.
    expect(rest!.route.salt).toBe(defaultSalt(SALT, 1n));
    expect(low(rest!.reward.creator)).toBe(CREATOR.slice(2));
    expect(rest!.route.calls.at(-1)!.value).toBe(1_000n);
  }, 120_000);

  it("defaults the deadlines from when the program opening it runs, with no time given", async () => {
    const program = compile(
      `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
      { salt: SALT, executionFee: 1_000n },
    );
    const before = (await base.local.publicClient.getBlock()).timestamp;
    const [opened] = await published(program);
    const at = (await base.local.publicClient.getBlock()).timestamp;
    expect(opened!.route.deadline).toBeGreaterThan(before + DEFAULT_FILL_WINDOW - 1n);
    expect(opened!.route.deadline).toBeLessThanOrEqual(at + DEFAULT_FILL_WINDOW);
    expect(opened!.reward.deadline).toBe(opened!.route.deadline + DEFAULT_REFUND_WINDOW);
  }, 120_000);

  it("a deadline computed as the program runs is written in", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .deadline(ctx.timestamp() + 3600)
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        { executionFee: 1_000n },
      ),
    );
    const at = (await base.local.publicClient.getBlock()).timestamp;
    expect(opened!.route.deadline).toBe(at + 3600n);
    expect(opened!.reward.deadline).toBe(at + 3600n + DEFAULT_REFUND_WINDOW);
  }, 120_000);

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
  }, 120_000);

  it("every intent names its refundee: there is no default", () => {
    expect(() =>
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        INTENTS,
      ),
    ).toThrow(
      /an intent needs `\.refundee\(<address>\)` after `\.send\(\.\.\.\)`: the address an unfilled intent's reward is refunded to/,
    );
  });

  it("`fund: false` publishes the same intent, paying nothing into its vault", async () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { native: 5 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => {
      Optimism.Portal.send({ token: USDC, amount: 7 })
        .refundee(${CREATOR})
        .receive({ token: USDC, amount: 6 })
        .then(() => { USDC.transfer(RECIPIENT, 6); });
    });
}`;
    const held = () =>
      Promise.all([
        base.local.publicClient.readContract({
          address: base.token("USDC"),
          abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
          functionName: "balanceOf",
          args: [base.pot],
        }),
        base.local.publicClient.getBalance({ address: base.pot }),
      ]);
    const snapshot = await base.local.testClient.snapshot();
    const before = await held();
    const [unfunded] = await published(compile(program, { ...INTENTS, fund: false }));
    // The Pot paid nothing: no reward token, and no native beyond the cook's own value.
    expect(await held()).toEqual(before);
    await base.local.testClient.revert({ id: snapshot });
    const [funded] = await published(compile(program, INTENTS));
    expect(await held()).not.toEqual(before);
    // The same intent, the nested one in its body included: only the root's rewards go unpaid.
    expect(unfunded).toEqual(funded);
  }, 120_000);

  it("mixes the compile's salt with the intents the transaction opened; a `.salt(...)` is as written", async () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const [given] = await published(compile(program, INTENTS));
    expect(given!.route.salt).toBe(defaultSalt(SALT, 1n));
    const [salted] = await published(
      compile(program.replace(".then(", ".salt(0x1234)\n    .then("), INTENTS),
    );
    expect(salted!.route.salt).toBe(`0x${"1234".padStart(64, "0")}`);
  }, 120_000);

  it("two intents built alike are two intents, in sequence or in a loop", async () => {
    const intent = `Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });`;
    const twice = await published(
      compile(`function main() {\n  ${intent}\n  ${intent}\n}`, INTENTS),
    );
    const looped = await published(
      compile(
        `function main() {\n  for (let i = 0; i < 2; i += 1) {\n    ${intent}\n  }\n}`,
        INTENTS,
      ),
    );
    for (const [one, two] of [twice, looped]) {
      expect([one!.route.salt, two!.route.salt]).toEqual([
        defaultSalt(SALT, 1n),
        defaultSalt(SALT, 2n),
      ]);
      expect(hashIntent(one!).intentHash).not.toBe(hashIntent(two!).intentHash);
    }
  }, 120_000);

  it("takes each item as an argument, as one list", async () => {
    const opened = async (send: string, receive: string) =>
      (
        await published(
          compile(
            `function main() {
  Arbitrum.Portal.send(${send})
    .refundee(${CREATOR})
    .receive(${receive})
    .then(() => { USDC.transfer(RECIPIENT, 1000000); WETH.transfer(RECIPIENT, 5); });
}`,
            INTENTS,
          ),
        )
      )[0]!;
    const paid = "{ token: USDC, amount: 1010000 }, { token: WETH, amount: 5 }";
    const delivered = "{ token: USDC, amount: 1000000 }, { token: WETH, amount: 5 }";
    const asArguments = await opened(`${paid}, { native: 5 }`, delivered);
    expect(asArguments).toEqual(await opened(`[${paid}], { native: 5 }`, `[${delivered}]`));
    expect(asArguments).toEqual(await opened(`[${paid}, { native: 5 }]`, `[${delivered}]`));
    expect(asArguments.reward.nativeAmount).toBe(5n);
    expect(asArguments.reward.tokens).toHaveLength(2);
    expect(asArguments.route.tokens).toHaveLength(2);
    // The delivery is the destination's token of each symbol.
    expect(BigInt(asArguments.route.tokens[0]!.token)).toBe(usdcOf("arbitrum"));
    expect(BigInt(asArguments.reward.tokens[0]!.token)).toBe(usdcOf("base"));
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);

  it("fills the Portals, the prover and the destination's shared Pot from the registry", async () => {
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
    expect(low(opened!.route.portal)).toBe(low(ecoRoutesPortal("arbitrum")));
    expect(low(opened!.reward.prover)).toBe(low(ecoRoutesProver("base", "arbitrum")));
    const pot = v12PredictPot(ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum")));
    expect(opened!.route.calls.map((call) => low(call.target))).toEqual([
      low(hex(usdcOf("arbitrum"))),
      low(pot),
    ]);
  }, 120_000);

  it("cooks on the Pot of an overriding destination Portal's Executor, or the one named", async () => {
    const program = `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`;
    const portal = "0x6666666666666666666666666666666666666666" as Hex;
    const [overridden] = await published(
      compile(program, { ...INTENTS, destinationPortal: portal }),
    );
    expect(low(overridden!.route.portal)).toBe(low(portal));
    expect(low(overridden!.route.calls[1]!.target)).toBe(
      low(v12PredictPot(ecoRoutesExecutorOf(portal))),
    );
    const pot = "0x7777777777777777777777777777777777777777";
    const [named] = await published(compile(program, { ...INTENTS, pot }));
    expect(low(named!.route.calls[1]!.target)).toBe(low(pot));
  }, 120_000);

  it("funds a token listed twice once, for the larger amount", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 7 }, { token: USDC, amount: 9 }, { token: USDC, amount: 4 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1 })
    .then(() => { USDC.transfer(RECIPIENT, 1); });
}`,
        INTENTS,
      ),
    );
    expect(opened!.reward.tokens.map((t) => t.amount)).toEqual([7n, 9n, 4n]);
    const vault = predictIntentVault(opened!, { portal: base.portal });
    expect(await base.local.balanceOf(base.token("USDC"), vault)).toBe(9n);
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);

  it("publishAndFund approves the Portal and has it pull the reward", async () => {
    const [opened] = await published(
      compile(
        `function main() {
  Arbitrum.Portal.send({ token: USDC, amount: 1010000 }, { token: USDC, amount: 7 })
    .refundee(${CREATOR})
    .receive({ token: USDC, amount: 1000000 })
    .then(() => { USDC.transfer(RECIPIENT, 1000000); });
}`,
        { ...INTENTS, fundVia: "publishAndFund" },
      ),
    );
    expect(opened!.reward.tokens.map((t) => t.amount)).toEqual([1_010_000n, 7n]);
  }, 120_000);

  it("a TypeScript intent's cook publishes what the same statement in a file publishes", async () => {
    const built = Arbitrum.Portal.send({ token: base.token("USDC"), amount: 1_010_000n })
      .source(Base, { defines: { RECIPIENT }, intents: INTENTS })
      .refundee(CREATOR)
      .receive({ token: hex(usdcOf("arbitrum")), amount: 1_000_000n })
      .then(() => {
        USDC.transfer(RECIPIENT, 1_000_000n);
      });
    const cook = built.cook(base.pot, KITCHEN_FEE);
    const hash = await base.local.send(base.local.deployer, cook.to, cook.data, cook.value);
    const { logs } = await base.local.publicClient.getTransactionReceipt({ hash });
    const [sent] = built.intents(logs);
    const [written] = await published(
      compile(
        `Arbitrum.Portal.send({ token: ${base.token("USDC")}, amount: 1010000 })
  .refundee(${CREATOR})
  .receive({ token: ${hex(usdcOf("arbitrum"))}, amount: 1000000 })
  .then(() => { USDC.transfer(RECIPIENT, 1000000); });`,
        INTENTS,
      ),
    );
    expect(sent!.destination.slug).toBe("arbitrum");
    expect(sent!.intent).toEqual(written);
  }, 120_000);
});

describe("on the host", () => {
  const delivered = [{ token: hex(usdcOf("base")), amount: 1_000_000n }];
  const paid = { token: hex(usdcOf("ethereum")), amount: 1_010_000n };
  const FEE = 1_000n;
  const body = "USDC.transfer(0x6666666666666666666666666666666666666666, 1000000);";
  const options = { intents: { salt: SALT } } as const;

  it("writes the statement a program opens it with, and compiles it for the source chain", () => {
    const built = Base.Portal.send(paid)
      .source(Ethereum, options)
      .refundee(CREATOR)
      .deadline(REWARD_DEADLINE + 1n)
      .receive(delivered)
      .fee(FEE)
      .deadline(DEADLINE)
      .then(body);
    const written = `Base.Portal.send({ token: ${paid.token}, amount: 1010000 })
  .refundee(${CREATOR})
  .deadline(${REWARD_DEADLINE + 1n})
  .receive({ token: ${delivered[0]!.token}, amount: 1000000 })
  .deadline(${DEADLINE})
  .fee(1000)
  .then(() => { ${body} });`;
    expect(built.program.chain.slug).toBe("ethereum");
    expect(built.program.bodies.map((each) => each.destination.slug)).toEqual(["base"]);
    expectSame(built.program, compileSauceProgram("ethereum", written, options));
    expect(built.source).toContain(`.refundee(${CREATOR})`);
  });

  it("takes a closure as the body, and items as arguments or one list", () => {
    const sentOf = () => Base.Portal.send([paid]).source(Ethereum, options).refundee(CREATOR);
    const one = sentOf()
      .receive(delivered[0]!)
      .fee(FEE)
      .then(() => {
        USDC.transfer(0x6666666666666666666666666666666666666666n, 1_000_000n);
      });
    const many = sentOf().receive(delivered).fee(FEE).then(body);
    expectSame(one.program, many.program);
  });

  it("cooks on a Pot, named or by its owner, with the source Kitchen's fee as its value", () => {
    const built = Base.Portal.send(paid)
      .source("ethereum", options)
      .refundee(CREATOR)
      .receive()
      .fee(FEE)
      .then(body);
    const byOwner = built.cook({ owner: CREATOR }, 9n);
    expect(byOwner.to).toBe(v12PredictPot(CREATOR));
    expect(byOwner.value).toBe(9n);
    const decoded = decodeFunctionData({
      abi: parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]),
      data: byOwner.data,
    });
    expect(decoded.args[1]).toBe(bytesToHex(built.program.bytecode));
    expect(built.cook(byOwner.to, 9n)).toEqual(byOwner);
  });

  it("refuses an intent with no source chain, a modifier given twice, and a handler", () => {
    expect(() =>
      Base.Portal.send(paid).refundee(CREATOR).receive(delivered).fee(FEE).then(body),
    ).toThrow(/give `\.source\(\.\.\.\)` after `\.send\(\.\.\.\)`/);
    expect(() =>
      Base.Portal.send(paid).source("ethereum", options).receive(delivered).fee(FEE).then(body),
    ).toThrow(/an intent needs `\.refundee\(<address>\)`/);
    const sent = Base.Portal.send(paid).refundee(CREATOR) as unknown as {
      refundee(address: string): unknown;
    };
    expect(() => sent.refundee(CREATOR)).toThrow(/`\.refundee\(\.\.\.\)` is given twice/);
    const built = Base.Portal.send(paid)
      .source("ethereum", options)
      .refundee(CREATOR)
      .receive(delivered)
      .fee(FEE)
      .then(body);
    expect(() => built.catch(() => {})).toThrow(TypeError);
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
    expect(
      refused(
        `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then}.${old}(1);`,
      ),
    ).toThrow("after `.then(...)` its one step is `.catch(...)`");
  });

  it("refuses a second `.catch(...)`", () => {
    expect(
      refused(
        `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then}.catch((e) => {}).catch((e) => {});`,
      ),
    ).toThrow(/`\.catch\(\.\.\.\)` is not a step after `\.catch\(\.\.\.\)`/);
  });

  it("refuses allowPartial, which only publishAndFund takes, and a fundVia it does not know", () => {
    const opens = `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then};`;
    expect(() =>
      compile(`function main() {\n${opens}\n}`, { ...INTENTS, allowPartial: true }),
    ).toThrow(/`intents.allowPartial` goes with `fundVia: "publishAndFund"`/);
    expect(() =>
      compile(`function main() {\n${opens}\n}`, {
        ...INTENTS,
        fundVia: "permit" as unknown as "transfer",
      }),
    ).toThrow(/`intents.fundVia` is 'permit'/);
  });

  it("a `const` holding the intent opens it where its block ends", () => {
    expectSame(
      compile(
        `function main() {\n  const opened = Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then};\n}`,
        INTENTS,
      ),
      compile(
        `function main() {\n  Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then};\n}`,
        INTENTS,
      ),
    );
  });

  it.each([
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item});`,
      /has no body\. Finish it with `\.then/,
    ],
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
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).deadline(1).deadline(2).receive(${item})${then};`,
      /`\.deadline\(\.\.\.\)` is given twice after `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item}).salt(1).salt(2)${then};`,
      /`\.salt\(\.\.\.\)` is given twice after `\.receive\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).salt(1).receive(${item})${then};`,
      /`\.salt\(\.\.\.\)` is not a step after `\.send\(\.\.\.\)`: its steps are `\.refundee/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).refundee(1)${then};`,
      /`\.refundee\(\.\.\.\)` is not a step after `\.receive\(\.\.\.\)`: its steps are `\.deadline/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item}).memo(1)${then};`,
      /`memo` is not a member of .*after `\.receive\(\.\.\.\)` its steps are/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then}.salt(1);`,
      /`\.salt\(\.\.\.\)` is not a step after `\.then\(\.\.\.\)`: its one step is `\.catch/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).deadline().receive(${item})${then};`,
      /`\.deadline\(\.\.\.\)` takes the deadline, in Unix seconds/,
    ],
    [
      `Arbitrum.Portal.send().refundee(${CREATOR}).receive(${item})${then};`,
      /`\.send\(\.\.\.\)` must offer something: a token amount, or `\{ native: amount \}`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive({ native: 1 })${then};`,
      /`\.receive\(\.\.\.\)` names tokens: the native coin is paid with `\.send\(\.\.\.\)`/,
    ],
    [
      `Arbitrum.Portal.send([{ native: 1 }, { native: 2 }]).refundee(${CREATOR}).receive(${item})${then};`,
      /`\.send\(\.\.\.\)` names its native amount once/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive({ token: USDC })${then};`,
      /each item `\.receive\(\.\.\.\)` takes is `\{ token, amount \}`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).refundee(${CREATOR}).receive({ token: USDT, amount: 1 })${then};`,
      /`USDT` is not a token or protocol on arbitrum\. Did you mean `USDC` or `USDT0`\?/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 - 2 }).refundee(${CREATOR}).receive(${item})${then};`,
      /constant `-` expression overflows 256 bits/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1 / 0 }).refundee(${CREATOR}).receive(${item})${then};`,
      /constant `\/` expression divides by zero/,
    ],
    [
      `Solana.Portal.send(${item}).refundee(${CREATOR}).receive(${item})${then};`,
      /an intent a program opens runs its body on an EVM chain: solana/,
    ],
  ])("%s", (body, message) => {
    expect(refused(body)).toThrow(message);
  });
});
