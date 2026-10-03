/**
 * `Chain.Portal.send({ ... }).receive({ ... }).then(() => { ... })` written inside a Sauce program.
 *
 * The property under test is not "does it compile" — it is **which values end up where**. A value
 * the enclosing program has only while it runs cannot be in the encoded intent; it is a sentinel
 * that the program splices over at run time. A define is known when the intent is built and is
 * baked in. Getting those two backwards produces an intent that compiles, publishes, and carries a
 * number nobody chose, which is why every case below asserts on the bytes rather than on acceptance.
 *
 * Every intent the compile binds is recorded with the arguments its `@sauce/intents` call receives
 * (`src/routes/intent-host.ts`). `routes-nest-dynamic.e2e.test.ts` and
 * `routes-intent-chains.e2e.test.ts` run the result against a real Portal.
 */
import { decodeFunctionData, erc20Abi, toFunctionSelector, type AbiFunction, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { v12Kitchen } from "../src/evm/engine.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

// ESM jest exposes `jest` on `import.meta`, and every module that compiles must be imported AFTER
// the mock is registered, so those imports are dynamic.
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
const realIntents = await import("../src/routes/intent-host.js");
type Bound = ReturnType<ReturnType<typeof realIntents.intentHost>["bind"]>;
/** The arguments of each `@sauce/intents` call bound since the last `lower`, in bind order. */
let bound: Bound[] = [];
jest.unstable_mockModule("../src/routes/intent-host.js", () => ({
  ...realIntents,
  intentHost: (level: Parameters<typeof realIntents.intentHost>[0]) => {
    const host = realIntents.intentHost(level);
    return {
      ...host,
      bind: (site: Parameters<typeof host.bind>[0]) => {
        const args = host.bind(site);
        bound.push(args);
        return args;
      },
    };
  },
}));
const { compileSauceProgram, compileSauceRoute } = await import("../src/routes/sauce-route.js");

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const RECIPIENT_ADDRESS = "0x9999999999999999999999999999999999999999" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
/** One salt for every compile here, so two compiles of one intent are one intent: each picks a
 *  random one otherwise. */
const SALT = `0x${"5a".repeat(32)}` as const;
const DEFAULTS = { deadline: 4_000_000_000n, publisher: CREATOR, salt: SALT };

const usdcOf = (slug: string): bigint => registryTokenAddress(requireChain(slug), "USDC")!;
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;

/** `source` compiled for Base: its lowered intents, and what each one's library call receives. */
function lower(source: string, intents: Record<string, unknown> = DEFAULTS) {
  bound = [];
  const program = compileSauceProgram("base", source, { defines: { RECIPIENT }, intents });
  return { intents: program.intents, bound: [...bound] };
}

const program = (body: string) =>
  `function main() {\n  const amount = USDC.balanceOf(self);\n${body}\n}`;

const TRANSFER_INTENT =
  program(`  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });`);

const selector = (name: string) =>
  toFunctionSelector(
    PortalABI.find((item) => item.type === "function" && item.name === name) as AbiFunction,
  );
const bytesHex = (argument: Bound[number]): Hex => {
  if (!("bytes" in argument)) throw new Error("expected a byte string");
  return `0x${Buffer.from(argument.bytes).toString("hex")}`;
};

describe("a token symbol resolves against the chain the calls run on", () => {
  it("uses the DESTINATION's registry for the body, and the enclosing chain's for the reward", () => {
    const [lowered] = lower(TRANSFER_INTENT).intents;

    // Arbitrum's USDC, because the transfer executes on Arbitrum. Resolving it against Base would
    // put a Base address in an Arbitrum route -- most likely not a token at all.
    expect(BigInt(denormalizeToEvm(lowered!.intent.route.calls[0]!.target))).toBe(
      usdcOf("arbitrum"),
    );
    expect(BigInt(denormalizeToEvm(lowered!.intent.reward.tokens[0]!.token))).toBe(usdcOf("base"));
  });
});

describe("what the lowering produces", () => {
  it("captures the enclosing local and splices it wherever it appears", () => {
    const {
      intents,
      bound: [args],
    } = lower(TRANSFER_INTENT);

    expect(intents).toHaveLength(1);
    expect(intents[0]!.captures).toEqual(["amount"]);
    // The transfer's amount, the delivery it derives and the reward: three places in `publish`.
    const publish = args![1]!;
    expect("bytes" in publish && publish.splices!.length).toBe(3);
    for (const { capture } of intents[0]!.sentinels) expect(capture).toBe("amount");
  });

  it("bakes a compile-time define in, rather than capturing it", () => {
    const [lowered] = lower(TRANSFER_INTENT).intents;
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: lowered!.intent.route.calls[0]!.data,
    });

    expect(decoded.functionName).toBe("transfer");
    // The recipient is the define's value; only the amount is a sentinel.
    expect(BigInt(decoded.args![0] as Hex)).toBe(RECIPIENT);
    expect(lowered!.captures).not.toContain("RECIPIENT");
  });

  // The Executor runs these calls raw, and USDT refuses to move a non-zero allowance to another
  // non-zero value. One Executor runs every intent on a chain, so the approve is reset to zero first.
  describe("a token-only approve is reset to zero first", () => {
    const approveIntent = (spender: string, amount: string) =>
      program(`  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    USDC.approve(${spender}, ${amount});
  });`);
    const callsOf = (source: string) =>
      lower(source).intents[0]!.intent.route.calls.map((call) => {
        const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
        return [functionName, BigInt(args![0] as Hex), args![1]];
      });

    it("emits approve(spender, 0) before approve(spender, amount)", () => {
      expect(callsOf(approveIntent("RECIPIENT", "7n"))).toEqual([
        ["approve", RECIPIENT, 0n],
        ["approve", RECIPIENT, 7n],
      ]);
    });

    it("needs no reset to approve zero", () => {
      expect(callsOf(approveIntent("RECIPIENT", "0n"))).toEqual([["approve", RECIPIENT, 0n]]);
    });

    it("resets before a captured amount, whose value is unknown when the intent is built", () => {
      const calls = callsOf(approveIntent("RECIPIENT", "amount"));
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(["approve", RECIPIENT, 0n]);
      expect(calls[1]![2]).not.toBe(0n);
    });

    it("splices a captured spender into both calls", () => {
      const publish = lower(approveIntent("amount", "7n")).bound[0]![1]!;
      // Both approves' spender, plus the reward amount.
      expect("bytes" in publish && publish.splices!.length).toBeGreaterThanOrEqual(3);
    });

    it("leaves a transfer one call", () => {
      expect(callsOf(TRANSFER_INTENT).map(([name]) => name)).toEqual(["transfer"]);
    });
  });

  describe("a top-level `const` is baked in, as a define is", () => {
    // Known when the file is compiled, so nothing is spliced at run time and the intent is fixed:
    // `sauce intent publish` can build it from a wallet.
    const site = `Arbitrum.Portal.send([{ token: USDC, amount: AMOUNT }]).receive().then(() => {
    USDC.transfer(RECIPIENT, AMOUNT);
  });`;
    const amountsOf = (source: string, defines: Record<string, bigint> = {}) => {
      bound = [];
      const [lowered] = compileSauceProgram("base", source, {
        defines: { RECIPIENT, ...defines },
        intents: DEFAULTS,
      }).intents;
      const call = decodeFunctionData({
        abi: erc20Abi,
        data: lowered!.intent.route.calls[0]!.data,
      });
      return {
        captures: lowered!.captures,
        transfer: call.args![1],
        delivered: lowered!.intent.route.tokens[0]!.amount,
        reward: lowered!.intent.reward.tokens[0]!.amount,
      };
    };
    const fixed = { captures: [], transfer: 7n, delivered: 7n, reward: 7n };

    it("in a module", () => {
      expect(amountsOf(`const AMOUNT = 7n;\nfunction main() {\n  ${site}\n}`)).toEqual(fixed);
    });

    it("in a script, where the other top-level statements are the entry", () => {
      expect(amountsOf(`const AMOUNT = 7n;\n${site}`)).toEqual(fixed);
    });

    it("but not where a local of the opening function shadows it", () => {
      const source = `const AMOUNT = 7n;\nfunction main() {\n  const AMOUNT = USDC.balanceOf(self);\n  ${site}\n}`;
      expect(amountsOf(source).captures).toEqual(["AMOUNT"]);
    });

    it("and a define of the same name replaces it, as it does in the compiler", () => {
      expect(
        amountsOf(`const AMOUNT = 7n;\nfunction main() {\n  ${site}\n}`, { AMOUNT: 9n }),
      ).toEqual({ captures: [], transfer: 9n, delivered: 9n, reward: 9n });
    });

    it("while a computed `const` of a script is still a value of the program", () => {
      expect(amountsOf(`const AMOUNT = 7n * 1n;\n${site}`).captures).toEqual(["AMOUNT"]);
    });
  });

  // SauceScript writes an integer plainly: the compiler reads a literal from its text, so one past
  // 2^53 is the integer its `n` spelling is.
  describe("a plain integer is exact past 2^53, as its `n` spelling is", () => {
    const WEI = 1_000_000_000_000_000_000_001n; // 1e21 + 1: no float holds it
    const lowered = (amount: string, recipient: string, top = "") =>
      lower(
        `${top}function main() {\n  Arbitrum.Portal.send({ token: USDC, amount: ${amount} }).receive().then(() => {\n` +
          `    USDC.transfer(${recipient}, ${amount});\n  });\n}`,
      ).intents[0]!;

    it("an amount and an address, in the body and the reward", () => {
      const plain = lowered("1000000000000000000001", RECIPIENT_ADDRESS);
      const call = decodeFunctionData({ abi: erc20Abi, data: plain.intent.route.calls[0]!.data });

      expect(call.args).toEqual([RECIPIENT_ADDRESS, WEI]);
      expect(plain.intent.route.tokens[0]!.amount).toBe(WEI);
      expect(plain.intent.reward.tokens[0]!.amount).toBe(WEI);
      expect(plain.intent).toEqual(
        lowered("1000000000000000000001n", `${RECIPIENT_ADDRESS}n`).intent,
      );
    });

    it("with separators, and in hex", () => {
      const expected = lowered("1000000000000000000001n", RECIPIENT_ADDRESS).intent;

      expect(lowered("1_000_000_000_000_000_000_001", RECIPIENT_ADDRESS).intent).toEqual(expected);
      expect(lowered("0x3635c9adc5dea00001", RECIPIENT_ADDRESS).intent).toEqual(expected);
    });

    it("as a top-level `const`, baked in", () => {
      const baked = lowered(
        "AMOUNT",
        RECIPIENT_ADDRESS,
        "const AMOUNT = 1000000000000000000001;\n",
      );

      expect(baked.captures).toEqual([]);
      expect(baked.intent.reward.tokens[0]!.amount).toBe(WEI);
    });
  });

  it("fills the Portal, the prover and the destination from the registry", () => {
    const { intent, destination } = lower(TRANSFER_INTENT).intents[0]!;

    expect(destination.slug).toBe("arbitrum");
    expect(intent.destination).toBe(BigInt(ARBITRUM.id));
    expect(intent.sourceChainId).toBe(BigInt(BASE.id));
    expect(denormalizeToEvm(intent.route.portal).toLowerCase()).toBe(
      ecoRoutesPortal("arbitrum").toLowerCase(),
    );
    expect(denormalizeToEvm(intent.reward.prover).toLowerCase()).toBe(
      ecoRoutesProver("base", "arbitrum").toLowerCase(),
    );
  });

  describe("funds the reward by transfer to its vault, then publishes — the default", () => {
    it("reads the vault from the Portal over the bytes it publishes, and approves nothing", () => {
      const {
        intents,
        bound: [args],
      } = lower(TRANSFER_INTENT);
      const [portal, publish, vaultSelector, rewards, native] = args!;

      expect(intents[0]!.fundVia).toBe("transfer");
      // `@sauce/intents#publish`: the source Portal, the `publish` payload, and the selector the
      // vault is read with over that same payload — one copy of the intent, so the vault read and
      // the published intent cannot differ.
      expect("value" in portal! && portal.value.toLowerCase()).toBe(
        ecoRoutesPortal("base").toLowerCase(),
      );
      expect(bytesHex(publish!).slice(0, 10)).toBe(selector("publish"));
      expect(bytesHex(vaultSelector!)).toBe(selector("intentVaultAddress"));
      // The reward: one entry, Base's USDC and the amount spliced in at run time.
      expect(bytesHex(rewards!).slice(0, 66)).toBe(word(usdcOf("base")));
      expect("bytes" in rewards! && rewards.splices).toEqual([
        { offset: 32, runtime: expect.any(Number) },
      ]);
      expect(bytesHex(native!)).toBe(word(0n));
    });

    it("sends a literal native reward, and splices a captured one", () => {
      const literal = lower(
        program(`  Arbitrum.Portal.send({ native: 9n }).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });`),
      ).bound[0]!;
      expect(bytesHex(literal[4]!)).toBe(word(9n));

      const captured = lower(
        program(`  Arbitrum.Portal.send({ token: USDC, amount: 3n }, { native: amount }).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });`),
      ).bound[0]!;
      expect("bytes" in captured[4]! && captured[4].splices).toEqual([
        { offset: 0, runtime: expect.any(Number) },
      ]);
    });

    it("hands every entry of a token listed twice to the library, which funds the larger", () => {
      const rewards = lower(
        program(`  const more = 9n;
  Arbitrum.Portal.send([{ token: USDC, amount }, { token: USDC, amount: more }, { token: USDC, amount: 4n }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });`),
      ).bound[0]![3]!;
      const hex = bytesHex(rewards).slice(2);
      // Three entries of 64 bytes, each Base's USDC; `more` is a constant, so it is baked in.
      expect(hex.length).toBe(3 * 128);
      for (const entry of [0, 1, 2]) {
        expect(`0x${hex.slice(entry * 128, entry * 128 + 64)}`).toBe(word(usdcOf("base")));
      }
      expect(`0x${hex.slice(128 + 64, 256)}`).toBe(word(9n));
      expect(`0x${hex.slice(256 + 64)}`).toBe(word(4n));
    });

    it("refuses allowPartial, which only publishAndFund takes", () => {
      expect(() => lower(TRANSFER_INTENT, { ...DEFAULTS, allowPartial: true })).toThrow(
        /`intents.allowPartial` goes with `fundVia: "publishAndFund"`/,
      );
    });

    it("refuses a fundVia it does not know", () => {
      expect(() => lower(TRANSFER_INTENT, { ...DEFAULTS, fundVia: "permit" })).toThrow(
        /`intents.fundVia` is 'permit'/,
      );
    });
  });

  it("opted into publishAndFund: the Portal, the publishAndFund payload, the reward, the value", () => {
    const {
      intents,
      bound: [args],
    } = lower(TRANSFER_INTENT, { ...DEFAULTS, fundVia: "publishAndFund" });

    expect(intents[0]!.fundVia).toBe("publishAndFund");
    // `@sauce/intents#publishAndFund`: no vault read — the Portal pulls the reward into the vault it
    // derives itself — so five arguments, not six.
    expect(args).toHaveLength(5);
    expect(bytesHex(args![1]!).slice(0, 10)).toBe(selector("publishAndFund"));
    expect(bytesHex(args![2]!).slice(0, 66)).toBe(word(usdcOf("base")));
  });

  it("lowers several intents in one program", () => {
    const two = program(`  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
  Optimism.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });`);
    expect(lower(two).intents.map((i) => i.destination.slug)).toEqual(["arbitrum", "optimism"]);
  });
});

describe("a body that is not just token writes becomes a program", () => {
  // The token-write shape is an optimisation, not the feature: anything a route body can do belongs
  // inside an intent's braces.
  it.each([
    ["control flow", "if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }"],
    ["a local and arithmetic", "const half = amount / 2n; USDC.transfer(RECIPIENT, half);"],
    // The spelling the intents guide gives for opting a token-only body into SafeERC20 checks.
    [
      "an unused balance read",
      "const held = USDC.balanceOf(self); USDC.transfer(RECIPIENT, amount);",
    ],
    [
      "a method the token-write shape does not take",
      "USDC.transferFrom(RECIPIENT, RECIPIENT, amount);",
    ],
  ])("compiles a program for %s", (_name, body) => {
    const source = program(
      `  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {\n    ${body}\n  });`,
    );
    const [lowered] = lower(source, { ...DEFAULTS, executionFee: 0n }).intents;

    // One route call -- the cook -- rather than one per statement.
    expect(lowered!.intent.route.calls).toHaveLength(1);
    expect(lowered!.captures).toContain("amount");
  });

  it("a token write on Solana is never ERC-20 calldata aimed at the mint", () => {
    // On Solana `USDC` is the mint's key, with no token methods: the body is not a recording, and
    // its program is refused there by name.
    expect(() =>
      lower(
        program(
          `  Solana.Portal.send([{ token: USDC, amount }]).receive().then(() => {\n    USDC.transfer(RECIPIENT, amount);\n  });`,
        ),
      ),
    ).toThrow();
  });

  it("lowers an intent opened inside an intent, each by its own level", () => {
    const source = program(`  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    const got = USDC.balanceOf(self);
    Base.Portal.send([{ token: USDC, amount: got }]).creator(RECIPIENT).receive().then(() => {
      USDC.transfer(RECIPIENT, got);
    });
  });`);

    const { intents, bound: all } = lower(source, { ...DEFAULTS, executionFee: 0n });
    // The program's own intent is reported; the inner one was bound by the body's level, first.
    expect(intents).toHaveLength(1);
    expect(intents[0]!.intent.route.calls).toHaveLength(1);
    expect(all).toHaveLength(2);
  });
});

describe("the Pot a program body cooks on", () => {
  const PROGRAM_BODY =
    program(`  Arbitrum.Portal.send([{ token: USDC, amount }]).receive([{ token: USDC, amount }]).then(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }
  });`);
  const callsWith = (intents: Record<string, unknown> = {}) =>
    lower(PROGRAM_BODY, { ...DEFAULTS, executionFee: 0n, ...intents }).intents[0]!.intent.route
      .calls;
  const deploySelector = v12Kitchen
    .encodeDeployPot(RECIPIENT_ADDRESS, SAUCE_INTENT_POT_SALT)
    .slice(2, 10);

  it("delivers into it and cooks on it, and adds no deployment", () => {
    const calls = callsWith();
    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).functionName).toBe(
      "transfer",
    );
    for (const call of calls) expect(call.data.slice(2, 10)).not.toBe(deploySelector);
  });

  it("cooks on the registry Portal's shared Pot", () => {
    const executor = ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum"));
    expect(denormalizeToEvm(callsWith()[1]!.target).toLowerCase()).toBe(
      v12PredictPot(executor).toLowerCase(),
    );
  });

  it("derives from an OVERRIDING destination Portal's own Executor", () => {
    const portal = "0x6666666666666666666666666666666666666666" as Hex;
    const [lowered] = lower(PROGRAM_BODY, {
      ...DEFAULTS,
      executionFee: 0n,
      destinationPortal: portal,
    }).intents;
    // A Pot owned by the registry Portal's Executor would reject this route's cook with
    // `NotOwner()`: the route records `portal`, so `portal`'s Executor is the caller.
    expect(denormalizeToEvm(lowered!.intent.route.portal)).toBe(portal);
    expect(denormalizeToEvm(lowered!.intent.route.calls[1]!.target).toLowerCase()).toBe(
      v12PredictPot(ecoRoutesExecutorOf(portal)).toLowerCase(),
    );
  });

  it("cooks on a Pot the caller names", () => {
    const pot = "0x7777777777777777777777777777777777777777";
    expect(denormalizeToEvm(callsWith({ pot })[1]!.target)).toBe(pot);
  });

  it("a program body needs the destination's execution fee", () => {
    expect(() => lower(PROGRAM_BODY)).toThrow(/executionFee/);
  });
});

describe("what it refuses, and how clearly", () => {
  it("an identifier nothing declares is the compiler's unknown name", () => {
    const source = program(
      "  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {\n    USDC.transfer(mystery, amount);\n  });",
    );
    expect(() => lower(source)).toThrow(/`mystery` is not a declared variable/);
  });

  describe("a token it cannot resolve, named as the chain it is on", () => {
    const intent = (deliveryToken: string, deliveryAmount = "amount", rewardToken = "USDC") =>
      program(`  Arbitrum.Portal.send([{ token: ${rewardToken}, amount }]).receive([{ token: ${deliveryToken}, amount: ${deliveryAmount} }]).then(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }
  });`);
    const lowerOne = (source: string) => lower(source, { ...DEFAULTS, executionFee: 0n });

    it("a delivery token the destination does not register", () => {
      expect(() => lowerOne(intent("WPOL"))).toThrow(
        /`WPOL` is not a token or protocol on arbitrum/,
      );
    });

    it("a delivery token the program only has while it runs", () => {
      expect(() => lowerOne(intent("amount"))).toThrow(
        /the delivery token is a variable of the program, known only while it runs/,
      );
    });

    it("a delivery amount nothing resolves", () => {
      expect(() => lowerOne(intent("USDC", "mystery"))).toThrow(
        /`mystery` is not a declared variable/,
      );
    });

    it("a reward token the enclosing chain does not register", () => {
      expect(() => lowerOne(intent("USDC", "amount", "USDT"))).toThrow(
        /`USDT` is not a token or protocol on base/,
      );
    });
  });

  it("names the creator when the intent has none and no wallet publishes it", () => {
    expect(() => lower(TRANSFER_INTENT, {})).toThrow(/needs `\.creator\(<address>\)`/);
    expect(() => lower(TRANSFER_INTENT, { deadline: 1n })).toThrow(
      /needs `\.creator\(<address>\)`/,
    );
  });

  it("says which chain has no eco-routes deployment", () => {
    const source = program(`  Zora.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    Token(0x7777777777777777777777777777777777777777).transfer(RECIPIENT, amount);
  });`);
    expect(() => lower(source)).toThrow(/eco-routes v3 is not deployed on zora/);
  });

  it("leaves a program with no intent in it alone", () => {
    const { intents, bound: none } = lower("function main(): Uint256 { return 1n; }");
    expect(intents).toEqual([]);
    expect(none).toEqual([]);
  });

  it("a syntax error is the compiler's", () => {
    expect(() =>
      compileSauceRoute("base", "function main( { USDC.transfer(RECIPIENT, 1n); }", {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(/Expected/);
  });
});

describe("through the route compile", () => {
  const execution = {
    pot: "0x1111111111111111111111111111111111111111",
    engine: "0x2222222222222222222222222222222222222222",
  } as const;

  it("compiles, with no Portal or selector written by the caller", () => {
    const out = compileSauceRoute("base", TRANSFER_INTENT, execution, {
      defines: { RECIPIENT },
      intents: DEFAULTS,
    });
    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("an intent that captures nothing: every value a define or a literal", () => {
    const {
      intents,
      bound: [args],
    } = lower(`function main() {
  Arbitrum.Portal.send([{ token: USDC, amount: 7n }]).receive().then(() => {
    USDC.transfer(RECIPIENT, 5n);
  });
}`);
    expect(intents[0]!.captures).toEqual([]);
    // No slot to fill: the whole publish calldata is fixed.
    expect("bytes" in args![1]! && args![1].splices).toEqual([]);
    expect(bytesHex(args![1]!)).not.toContain("5acecab7");
  });

  it.each(["transfer", "publishAndFund"] as const)(
    "compiles a captured native reward and a token listed twice, funded via %s",
    (fundVia) => {
      const out = compileSauceRoute(
        "base",
        `function main() {
  const amount = USDC.balanceOf(self);
  const native = ctx.selfBalance();
  Arbitrum.Portal.send({ token: USDC, amount }, { token: USDC, amount: 7n }, { native: native }).receive().then(() => {
    USDC.transfer(RECIPIENT, 5n);
  });
}`,
        execution,
        { defines: { RECIPIENT }, intents: { ...DEFAULTS, fundVia } },
      );
      expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    },
  );

  it("the enclosing program's own token names work alongside it", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  const amount = Token(USDC).balanceOf(self);
  Arbitrum.Portal.send([{ token: USDC, amount }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
}`,
      execution,
      { defines: { RECIPIENT }, intents: DEFAULTS },
    );
    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
