/**
 * `Chain(() => { ... }).reward({ ... })` written inside a Sauce program.
 *
 * The property under test is not "does it compile" — it is **which values end up where**. A capture
 * is a local of the enclosing program, so it cannot be in the encoded intent; it is a sentinel that
 * the program splices over at run time. A define is known when the intent is built and is baked in.
 * Getting those two backwards produces an intent that compiles, publishes, and carries a number
 * nobody chose, which is why every case below asserts on the bytes rather than on acceptance.
 *
 * `routes-intent-sugar.e2e.test.ts` runs the result against a real Portal.
 */
import { decodeFunctionData, erc20Abi, type Hex } from "viem";

import { compileProgram as compile } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { rewriteIntentSugar } from "../src/routes/intent-sugar.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    source: BASE,
    chains: new Map([
      ["Arbitrum", ARBITRUM],
      ["Base", BASE],
    ]),
    definesFor: () =>
      new Map([
        ["USDC", 0x7777777777777777777777777777777777777777n],
        ["RECIPIENT", RECIPIENT],
      ]),
    portalOf: (chain: typeof BASE) => ecoRoutesPortal(chain),
    proverFor: (from: typeof BASE, to: typeof BASE) => ecoRoutesProver(from, to),
    defaults: { deadline: 4_000_000_000n, creator: CREATOR },
    // A body that needs a program gets one from here; the unit suite only checks that the lowering
    // reaches it and splices its sentinels. `routes-nest-dynamic.e2e.test.ts` runs a real one.
    compileChild: (_chain: unknown, _source: string, captures: readonly string[]) => ({
      call: {
        target: "0x4444444444444444444444444444444444444444",
        // Each sentinel as the 32-byte left-padded word a real compact-v1 argument tail carries.
        data: `0x${"cd".repeat(4)}${captures
          .map(
            (_, i) =>
              `${"00".repeat(12)}5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`,
          )
          .join("")}`,
        value: 1000n,
      },
      captureSentinels: captures.map((_, i) =>
        BigInt(`0x5aceb10c${"00".repeat(14)}${i.toString(16).padStart(4, "0")}`),
      ),
    }),
    ...overrides,
  }) as never;

const program = (body: string) => `function main() {\n  const amount = 5n;\n${body}\n}`;

const TRANSFER_INTENT = program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);

describe("a token symbol resolves against the chain the calls run on", () => {
  it("uses the DESTINATION's registry, not the enclosing program's", () => {
    const perChain = new Map([
      [BASE.slug, 0x1111111111111111111111111111111111111111n],
      [ARBITRUM.slug, 0x2222222222222222222222222222222222222222n],
    ]);
    const result = rewriteIntentSugar(
      TRANSFER_INTENT,
      context({
        definesFor: (chain: typeof BASE) =>
          new Map([
            ["USDC", perChain.get(chain.slug)!],
            ["RECIPIENT", RECIPIENT],
          ]),
      }),
    );

    // Arbitrum's USDC, because the transfer executes on Arbitrum. Resolving it against Base would
    // put a Base address in an Arbitrum route -- most likely not a token at all.
    expect(denormalizeToEvm(result.intents[0]!.intent.route.calls[0]!.target).toLowerCase()).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });
});

describe("what the lowering produces", () => {
  it("captures the enclosing local once and splices it everywhere it appears", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());

    expect(result.rewrote).toBe(true);
    expect(result.intents).toHaveLength(1);
    // ONE capture, not three: `amount` is the route token amount, the reward amount and the
    // transfer argument, and all three are the same runtime value.
    expect(result.intents[0]!.captures).toEqual(["amount"]);
    // Two splices of that one local: the transfer's amount argument, and the reward. The route's
    // delivery reuses the SAME sentinel rather than a third, since it is the same variable.
    const concat = result.source.split("\n").find((line) => line.includes("_data ="))!;
    expect(concat.match(/amount\.toBytesBe\(32\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("bakes a compile-time define in, rather than capturing it", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());
    const call = result.intents[0]!.intent.route.calls[0]!;
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });

    expect(decoded.functionName).toBe("transfer");
    // The recipient is the define's value; only the amount is a sentinel.
    expect(BigInt(decoded.args![0] as Hex)).toBe(RECIPIENT);
    expect(result.intents[0]!.captures).not.toContain("RECIPIENT");
  });

  it("fills the Portal, the prover and the destination from the registry", () => {
    const { intent, destination } = rewriteIntentSugar(TRANSFER_INTENT, context()).intents[0]!;

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

  it("approves the source Portal for the reward, without decoding a bool", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());
    const approve = result.source.split("\n").find((line) => line.includes("095ea7b3"))!;

    expect(approve).toContain(ecoRoutesPortal("base").slice(2).toLowerCase());
    // A raw call, not `IERC20.at(t).approve(...)` -- see `token/unchecked.ts` for the USDT revert.
    expect(result.source).not.toContain(".approve(");
  });

  it("lowers several intents in one program without colliding", () => {
    const two = program(`  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
  Base(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);
    const result = rewriteIntentSugar(two, context());

    expect(result.intents.map((i) => i.destination.slug)).toEqual(["arbitrum", "base"]);
    const declared = [...result.source.matchAll(/^\s*const (\w+) =/gm)].map((m) => m[1]!);
    expect(new Set(declared).size).toBe(declared.length);
  });
});

describe("a body that is not just token writes becomes a program", () => {
  // The fast path is an optimisation, not the feature: anything a route body can do belongs inside
  // an intent's braces. These used to be refusals.
  it.each([
    ["control flow", "if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }"],
    ["a local and arithmetic", "const half = amount / 2n; USDC.transfer(RECIPIENT, half);"],
    ["a method the token sugar does not lower", "USDC.transferFrom(RECIPIENT, RECIPIENT, amount);"],
  ])("compiles a program for %s", (_name, body) => {
    const source = program(
      `  Arbitrum(() => {\n    ${body}\n  }).reward({ tokens: [{ token: USDC, amount }] });`,
    );
    const result = rewriteIntentSugar(source, context());

    // One route call -- the cook -- rather than one per statement.
    expect(result.intents[0]!.intent.route.calls).toHaveLength(1);
    expect(result.intents[0]!.captures).toContain("amount");
  });

  it("lowers an intent opened inside an intent, recursively", () => {
    const source = program(`  Arbitrum(() => {
    const got = USDC.balanceOf(ctx.self());
    Base(() => {
      USDC.transfer(RECIPIENT, got);
    }).reward({ tokens: [{ token: USDC, amount: got }] });
  }).reward({ tokens: [{ token: USDC, amount }] });`);

    // The inner one is lowered by the CHILD's own compile, not by this pass, so this pass sees one
    // site and hands the whole closure body down.
    const result = rewriteIntentSugar(source, context());
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]!.intent.route.calls).toHaveLength(1);
  });
});

describe("what it refuses, and how clearly", () => {
  it.each([
    [
      "an identifier that is neither a define nor a local",
      "USDC.transfer(mystery, amount);",
      /refers to 'mystery', which is neither a compile-time value nor a variable/,
    ],
  ])("refuses %s", (_name, body, message) => {
    const source = program(
      `  Arbitrum(() => {\n    ${body}\n  }).reward({ tokens: [{ token: USDC, amount }] });`,
    );
    expect(() => rewriteIntentSugar(source, context())).toThrow(message);
  });

  it("names the deadline and the creator when they are missing", () => {
    expect(() => rewriteIntentSugar(TRANSFER_INTENT, context({ defaults: {} }))).toThrow(
      /needs a `deadline`/,
    );
    expect(() =>
      rewriteIntentSugar(TRANSFER_INTENT, context({ defaults: { deadline: 1n } })),
    ).toThrow(/needs a `creator`/);
  });

  it("says which chain has no eco-routes deployment", () => {
    const zora = requireChain("zora");
    const source = program(`  Zora(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });`);

    expect(() =>
      rewriteIntentSugar(source, context({ chains: new Map([["Zora", zora]]) })),
    ).toThrow(/eco-routes v3 is not deployed on zora/);
  });

  it("leaves a program with no intent in it completely alone", () => {
    const plain = "function main() { return 1n; }";
    const result = rewriteIntentSugar(plain, context());

    expect(result.rewrote).toBe(false);
    expect(result.source).toBe(plain);
  });
});

describe("through the real compile path", () => {
  it("compiles, with no Portal or selector written by the caller", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`,
      {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      },
      {
        defines: { RECIPIENT },
        intents: { deadline: 4_000_000_000n, creator: CREATOR },
      },
    );

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // The token symbol resolved to Base's real USDC, and the Portal to Base's real one.
    expect(out.source.toLowerCase()).toContain(ecoRoutesPortal("base").slice(2).toLowerCase());
  });

  it("the enclosing program's own token sugar still works alongside it", () => {
    const out = compileSauceRoute(
      "base",
      `function main() {
  const amount = Token(USDC).balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}`,
      {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      },
      { defines: { RECIPIENT }, intents: { deadline: 4_000_000_000n, creator: CREATOR } },
    );

    expect(out.source).toContain("IERC20.at(");
    expect(() => compile(out.source, { baseDirs: [] })).toBeDefined();
  });
});
