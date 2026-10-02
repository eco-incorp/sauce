/**
 * `Chain.Portal.send(reward).receive(delivery).then(body)` is
 * `Chain(body, { tokens: delivery }).reward({ tokens: reward })`, byte for byte.
 *
 * In a program: every compile the pipeline makes — the program's, and each nested intent's — is
 * recorded for both spellings and compared, so each level's lowered source, defines and bytecode
 * (which carries that level's `publish` calldata) must match, as must each intent the program
 * opens. The programs run on Base and open intents to Arbitrum and then Optimism, where `USDC` is a
 * different address each time, so a level resolving a name on the wrong chain differs.
 *
 * On the host: `Base.Portal.send(...).receive(...).then(body)` builds the intent `Base(body,
 * options).reward(reward)` builds, and its `then` refuses to be a promise's.
 *
 * And what the lowering refuses, by name: an expression that stops before its body, steps out of
 * order, a value used, a list not written out; and an amount's arithmetic that would revert.
 */
import { bytesToHex, decodeFunctionData, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

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
const INTENTS = { deadline: DEADLINE, creator: CREATOR, executionFee: 1_000n };
const usdcOf = (slug: string): bigint => registryTokenAddress(requireChain(slug), "USDC")!;

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
  Arbitrum.Portal.send({ token: USDC, amount: 1_010_000n })
    .receive({ token: USDC, amount: 1_000_000n })
    .then(() => {
      USDC.transfer(RECIPIENT, 1_000_000n);
    });
}`,
    call: `function main() {
  Arbitrum(() => {
      USDC.transfer(RECIPIENT, 1_000_000n);
    }, { tokens: [{ token: USDC, amount: 1_000_000n }] }).reward({ tokens: [{ token: USDC, amount: 1_010_000n }] });
}`,
    destinations: ["arbitrum"],
  },
  {
    name: "one level, a program body, arrays, a run-time amount and arithmetic",
    portal: `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99n / 100n }])
    .then(() => {
      USDC.transfer(recipient, amount * 99n / 100n);
    });
}`,
    call: `function main(amount: Uint256, recipient: Address) {
  Arbitrum(() => {
      USDC.transfer(recipient, amount * 99n / 100n);
    }, { tokens: [{ token: USDC, amount: amount * 99n / 100n }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
    destinations: ["arbitrum"],
  },
  {
    name: "nested: Base opens Arbitrum, whose body opens Optimism",
    portal: `function main(amount: Uint256, recipient: Address) {
  Arbitrum.Portal
    .send([{ token: USDC, amount }])
    .receive([{ token: USDC, amount: amount * 99n / 100n }])
    .then(() => {
      USDC.transfer(recipient, amount * 99n / 100n / 2n);
      Optimism.Portal.send({ token: USDC, amount: amount * 99n / 100n / 2n })
        .receive({ token: USDT, amount: amount * 98n / 100n / 2n })
        .then(() => { USDT.transfer(recipient, amount * 98n / 100n / 2n); });
    });
}`,
    call: `function main(amount: Uint256, recipient: Address) {
  Arbitrum(() => {
      USDC.transfer(recipient, amount * 99n / 100n / 2n);
      Optimism(() => { USDT.transfer(recipient, amount * 98n / 100n / 2n); }, { tokens: [{ token: USDT, amount: amount * 98n / 100n / 2n }] })
        .reward({ tokens: [{ token: USDC, amount: amount * 99n / 100n / 2n }] });
    }, { tokens: [{ token: USDC, amount: amount * 99n / 100n }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
    destinations: ["arbitrum", "optimism"],
  },
];

/** `program` with main's arguments bound as compile-time values, as `--args` binds them. */
const bound = (program: string) => program.replace(/main\([^)]*\)/, "main()");
const ARGS = { RECIPIENT, amount: 1_000_000n, recipient: RECIPIENT };

/** The ways a program opening an intent is compiled: as a program taking its arguments at run
 *  time, as one with them bound, and as a route's body. */
const PATHS = [
  [
    "compileSauceProgram",
    (program: string) =>
      compileSauceProgram("base", program, { defines: { RECIPIENT }, intents: INTENTS }).intents,
  ],
  [
    "compileSauceProgram, its arguments bound",
    (program: string) =>
      compileSauceProgram("base", bound(program), { defines: ARGS, intents: INTENTS }).intents,
  ],
  [
    "Base(program, options).reward(...)",
    (program: string) => [
      openRoute("base", bound(program), {
        deadline: DEADLINE,
        creator: CREATOR,
        source: "ethereum",
        defines: ARGS,
        compile: { intents: INTENTS },
      }).reward({ tokens: [] }).intent,
    ],
  ],
] as const;

describe.each(PATHS)("through %s", (_path, build) => {
  it.each(PAIRS)("$name: every level compiles to the same bytes", (pair) => {
    const portal = record(() => build(pair.portal));
    const call = record(() => build(pair.call));
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
  it.each(PAIRS)("$name: the same intent, hash and publish calldata", (pair) => {
    const [portal] = compileSauceProgram("base", bound(pair.portal), {
      defines: ARGS,
      intents: INTENTS,
    }).intents;
    const [call] = compileSauceProgram("base", bound(pair.call), {
      defines: ARGS,
      intents: INTENTS,
    }).intents;
    expect(portal!.intent).toEqual(call!.intent);
    expect(hashIntent(portal!.intent)).toEqual(hashIntent(call!.intent));
    const portalOn = { portal: ecoRoutesPortal(requireChain("base")) };
    expect(publishTx(portal!.intent, portalOn).data).toBe(publishTx(call!.intent, portalOn).data);
    // The reward is Base's USDC, escrowed where the program runs; the delivery is the
    // destination's.
    expect(BigInt(portal!.intent.reward.tokens[0]!.token)).toBe(usdcOf("base"));
    expect(BigInt(portal!.intent.route.tokens[0]!.token)).toBe(usdcOf(pair.destinations[0]!));
    expect(portal!.destination.slug).toBe(pair.destinations[0]);
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
    expect(opened!.captures).toEqual(["amount * 99n / 100n", "recipient", "amount"]);
  });
});

describe("on the host", () => {
  const options = {
    deadline: DEADLINE,
    defines: { RECIPIENT },
    execution: { value: 1_000n },
  } as const;
  const reward = { source: "ethereum", creator: CREATOR, deadline: DEADLINE + 3_600n } as const;
  const delivered = [
    { token: `0x${usdcOf("base").toString(16).padStart(40, "0")}` as Hex, amount: 1_000_000n },
  ];
  const paid = {
    token: `0x${usdcOf("ethereum").toString(16).padStart(40, "0")}` as Hex,
    amount: 1_010_000n,
  };

  it("builds the intent Base(body, options).reward(reward) builds", () => {
    const body = () => {
      USDC.transfer(RECIPIENT, 1_000_000n);
      Arbitrum.Portal.send({ token: USDC, amount: 1_000_000n })
        .receive({ token: USDC, amount: 990_000n })
        .then(() => {
          USDC.transfer(RECIPIENT, 990_000n);
        });
    };
    const built = Base.Portal.send(paid, reward)
      .receive(delivered, { ...options, compile: { intents: INTENTS } })
      .then(body);
    const expected = Base(body, {
      ...options,
      compile: { intents: INTENTS },
      tokens: delivered,
    }).reward({ ...reward, tokens: [paid] });

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

  it("takes a source text body, and one item or an array", () => {
    const program = "function main() { USDC.transfer(RECIPIENT, 1n); }";
    const one = Ethereum.Portal.send(paid, { ...reward, source: "base" })
      .receive(delivered[0]!, options)
      .then(program);
    const many = Ethereum.Portal.send([paid], { ...reward, source: "base" })
      .receive(delivered, options)
      .then(program);
    expect(one.intent).toEqual(many.intent);
  });

  const pending = () => Base.Portal.send(paid, reward).receive(delivered, options);

  it("refuses to be awaited: its then is the intent's", async () => {
    // TypeScript refuses the `await` itself (`routes-intent-portal-types.test.ts`); JavaScript, or
    // TypeScript told otherwise, reaches the `then`.
    await expect(
      (async () => {
        await (pending() as unknown);
      })(),
    ).rejects.toThrow(/is not a promise: `\.then\(\.\.\.\)` takes the intent's body/);
    await expect(Promise.resolve(pending())).rejects.toThrow(/by `await`/);
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
    compileSauceProgram("base", `function main() {\n${body}\n}`, { intents: INTENTS });
  const item = "{ token: USDC, amount: 1n }";

  it.each([
    [`Arbitrum.Portal.send(${item}).receive(${item});`, /has no body\. Finish it with `\.then/],
    [`Arbitrum.Portal.send(${item});`, /stops before `\.receive\(\.\.\.\)`/],
    [`Arbitrum.Portal.receive(${item}).send(${item}).then(() => {});`, /It starts with `\.send/],
    [`Arbitrum.Portal;`, /opens an intent on arbitrum/],
    [
      `const opened = Arbitrum.Portal.send(${item}).receive(${item}).then(() => {});`,
      /is a statement of its own/,
    ],
    [
      `const items = [${item}];\nArbitrum.Portal.send(items).receive(${item}).then(() => {});`,
      /`\.send\(\.\.\.\)` takes the reward written out in place/,
    ],
    [`Arbitrum.Portal.send([]).receive(${item}).then(() => {});`, /`\.send\(\[\]\)` pays nothing/],
    [
      `Arbitrum.Portal.send(${item}).receive().then(() => {});`,
      /`\.receive\(\.\.\.\)` takes one argument, what the solver delivers/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive(${item}).then(function () {});`,
      /`\.then\(\.\.\.\)` takes the intent's body, the code that runs on arbitrum/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDC }).then(() => {});`,
      /each entry of `\.receive\(\.\.\.\)` needs both `token` and `amount`/,
    ],
    [
      `Arbitrum.Portal.send(${item}).receive({ token: USDT, amount: 1n }).then(() => {});`,
      /The delivery — what `\.receive\(\.\.\.\)` names — is what the solver brings to arbitrum/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1n - 2n }).receive(${item}).then(() => {});`,
      /`\.send\(\.\.\.\)`'s `amount` is -1, outside an unsigned 256-bit word/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1n / 0n }).receive(${item}).then(() => {});`,
      /divides by zero/,
    ],
    [
      `Arbitrum.Portal.send({ token: USDC, amount: 1n > 0n }).receive(${item}).then(() => {});`,
      /uses `>`; an amount is integer arithmetic/,
    ],
  ])("%s", (body, message) => {
    expect(() => compile(body)).toThrow(message);
  });
});
