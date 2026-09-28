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
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { v12Kitchen } from "../src/evm/engine.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
const RECIPIENT_ADDRESS = "0x9999999999999999999999999999999999999999" as const;
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

  it("approves the source Portal for the reward with SafeERC20 semantics", () => {
    const result = rewriteIntentSugar(TRANSFER_INTENT, context());
    const portal = ecoRoutesPortal("base").slice(2).toLowerCase();
    const lines = result.source.split("\n").map((line) => line.trim());
    const approvals = lines.filter((line) => line.includes("095ea7b3"));

    // A raw call, not `IERC20.at(t).approve(...)`: the vendored ABI's `bool` return is decoded even
    // when discarded, and a token like USDT returns nothing. See `token/safe.ts`.
    expect(result.source).not.toContain(".approve(");
    // `forceApprove`, in two halves -- the reset to zero, then the real amount -- both naming the
    // Portal. One Pot publishes every intent on this chain, so the allowance an earlier intent left
    // behind is exactly the non-zero-to-non-zero change USDT refuses.
    expect(approvals).toHaveLength(2);
    for (const line of approvals) expect(line).toContain(portal);
    expect(approvals[0]).toContain(`${"0".repeat(64)}\``);
    // The reset costs a call only when there is something to reset, and that is decided from an
    // allowance read -- a `uint256`, always safe to decode -- rather than from a caught revert,
    // because a reverting `evm.call` cannot be caught in a Sauce program the way OZ catches it.
    expect(lines.some((line) => line.includes("dd62ed3e"))).toBe(true);
    expect(lines.some((line) => line.startsWith("if (") && line.includes("cur > 0n"))).toBe(true);
    // Both writes are judged: empty returndata only from an address with code, anything else true.
    expect(lines.filter((line) => line.includes("ctx.codeSize("))).toHaveLength(2);
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

describe("the Pot a program body cooks on", () => {
  const PROGRAM_BODY = program(`  Arbitrum(() => {
    if (amount > 1n) { USDC.transfer(RECIPIENT, amount); }
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount }] });`);
  it("delivers into it and cooks on it, and adds no deployment", () => {
    const calls = rewriteIntentSugar(PROGRAM_BODY, context()).intents[0]!.intent.route.calls;

    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).functionName).toBe(
      "transfer",
    );
    expect(denormalizeToEvm(calls[1]!.target)).toBe("0x4444444444444444444444444444444444444444");
  });

  it("hands the child compile the Portal the route records, override included", () => {
    const seen: unknown[] = [];
    const base = context() as unknown as { compileChild: (...args: unknown[]) => object };
    const override = "0x6666666666666666666666666666666666666666";
    const result = rewriteIntentSugar(
      PROGRAM_BODY,
      context({
        defaults: { deadline: 4_000_000_000n, creator: CREATOR, destinationPortal: override },
        compileChild: (...args: unknown[]) => {
          seen.push(args[3]);
          return base.compileChild(...args);
        },
      }),
    );

    expect(seen).toEqual([override]);
    expect(denormalizeToEvm(result.intents[0]!.intent.route.portal)).toBe(override);
  });

  describe("through the real compile path", () => {
    const compileWith = (intents: Record<string, unknown>) =>
      compileSauceRoute(
        "base",
        `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    const here = USDC.balanceOf(ctx.self());
    if (here > 0n) { USDC.transfer(RECIPIENT, here); }
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount }] });
}`,
        {
          pot: "0x1111111111111111111111111111111111111111",
          engine: "0x2222222222222222222222222222222222222222",
        },
        {
          defines: { RECIPIENT },
          intents: { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n, ...intents },
        },
      ).source;
    const cookOn = (pot: string) => pot.slice(2).toLowerCase().padStart(64, "0");
    const deploySelector = v12Kitchen
      .encodeDeployPot(RECIPIENT_ADDRESS, SAUCE_INTENT_POT_SALT)
      .slice(2, 10);

    it("cooks on the registry Portal's shared Pot, and deploys nothing", () => {
      const executor = ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum"));
      const source = compileWith({}).toLowerCase();

      expect(source).toContain(cookOn(v12PredictPot(executor)));
      expect(source).not.toContain(deploySelector);
    });

    it("derives from an OVERRIDING destination Portal's own Executor", () => {
      const portal = "0x6666666666666666666666666666666666666666" as Hex;
      const source = compileWith({ destinationPortal: portal }).toLowerCase();
      const registryExecutor = ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum"));

      // A Pot owned by the registry Portal's Executor would reject this route's cook with
      // `NotOwner()`: the route records `portal`, so `portal`'s Executor is the caller.
      expect(source).toContain(cookOn(v12PredictPot(ecoRoutesExecutorOf(portal))));
      expect(source).not.toContain(cookOn(v12PredictPot(registryExecutor)));
    });

    it("cooks on a Pot the caller names", () => {
      const pot = "0x7777777777777777777777777777777777777777";
      const source = compileWith({ pot }).toLowerCase();

      expect(source).toContain(cookOn(pot));
      expect(source).not.toContain(deploySelector);
    });
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
