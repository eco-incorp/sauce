/**
 * The manual's "What is refused" list, pinned to what the lowering actually refuses.
 *
 * This exists because it already went wrong: the docs kept describing refusals — a method other
 * than `transfer`, an intent inside an intent — for three commits after the lowering had stopped
 * refusing them and started compiling a program instead. Nothing failed, because nothing connected
 * the two.
 *
 * Each row below is one documented refusal: a phrase the guide must contain, and a program that
 * must trigger it. Widening what the lowering accepts fails here until the sentence goes; adding a
 * refusal without documenting it fails here too.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireChain } from "../src/chains/canonical.js";
import { SAUCE_INTENT_POT_SALT, v12GateKitchen } from "../src/deployments/pot.js";
import { v12Kitchen } from "../src/evm/engine.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { rewriteIntentSugar } from "../src/routes/intent-sugar.js";

const GUIDE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/guides/intents.md"),
  "utf8",
);

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const ZORA = requireChain("zora");
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    source: BASE,
    chains: new Map([
      ["Arbitrum", ARBITRUM],
      ["Zora", ZORA],
    ]),
    definesFor: () =>
      new Map([
        ["USDC", 0x7777777777777777777777777777777777777777n],
        ["RECIPIENT", 0x9999999999999999999999999999999999999999n],
      ]),
    portalOf: (chain: typeof BASE) => ecoRoutesPortal(chain),
    proverFor: (from: typeof BASE, to: typeof BASE) => ecoRoutesProver(from, to),
    defaults: { deadline: 4_000_000_000n, creator: CREATOR },
    compileChild: () => {
      throw new Error("no child program expected in these cases");
    },
    ...overrides,
  }) as never;

const wrap = (body: string, reward = "{ tokens: [{ token: USDC, amount }] }", chain = "Arbitrum") =>
  `function main() {\n  const amount = 5n;\n  ${chain}(() => {\n    ${body}\n  }).reward(${reward});\n}`;

/** Documented sentence -> the program that must produce it. */
const REFUSALS: readonly {
  readonly documented: string;
  readonly trigger: () => unknown;
  readonly message: RegExp;
}[] = [
  {
    documented: "neither a compile-time value nor a variable of the enclosing program",
    trigger: () => rewriteIntentSugar(wrap("USDC.transfer(mystery, amount);"), context()),
    message: /neither a compile-time value nor a variable/,
  },
  {
    documented: "a token entry missing `token` or `amount`",
    trigger: () =>
      rewriteIntentSugar(
        wrap("USDC.transfer(RECIPIENT, amount);", "{ tokens: [{ token: USDC }] }"),
        context(),
      ),
    message: /needs both `token` and `amount`/,
  },
  {
    documented: "A missing `deadline`",
    trigger: () =>
      rewriteIntentSugar(wrap("USDC.transfer(RECIPIENT, amount);"), context({ defaults: {} })),
    message: /needs a `deadline`/,
  },
  {
    documented: "a missing `creator`",
    trigger: () =>
      rewriteIntentSugar(
        wrap("USDC.transfer(RECIPIENT, amount);"),
        context({ defaults: { deadline: 1n } }),
      ),
    message: /needs a `creator`/,
  },
  {
    documented: "A chain with no eco-routes deployment",
    trigger: () =>
      rewriteIntentSugar(wrap("USDC.transfer(RECIPIENT, amount);", undefined, "Zora"), context()),
    message: /eco-routes v3 is not deployed on zora/,
  },
];

describe("the guide's refusal list is the lowering's", () => {
  it.each(REFUSALS.map((r) => [r.documented, r] as const))(
    "the guide documents %s",
    (_name, refusal) => {
      expect(GUIDE).toContain(refusal.documented);
    },
  );

  it.each(REFUSALS.map((r) => [r.documented, r] as const))(
    "and the lowering still refuses it: %s",
    (_name, refusal) => {
      expect(refusal.trigger).toThrow(refusal.message);
    },
  );

  it("does NOT still claim the refusals that were lifted", () => {
    // These were true before the closure became an arbitrary program, and describing them again
    // would send a reader to the TypeScript builder for something they can write directly.
    for (const lifted of [
      "A method other than `transfer` or `approve`",
      "there is no child program",
      "An intent opened inside another intent",
      "A statement that is not a call",
    ]) {
      expect(GUIDE).not.toContain(lifted);
    }
  });

  it("documents the two lowerings and what the general one costs", () => {
    for (const claim of [
      "only token `transfer`/`approve`",
      "a program compiled for the destination",
      "destinationExecutionFee",
      "one canonical Pot per chain",
      "leave nothing in it",
    ]) {
      expect(GUIDE).toContain(claim);
    }
  });
});

describe("the guide's account of the destination Pot is the builder's", () => {
  // Each claim is a sentence the guide must contain and a check on what `openRoute` builds. The
  // gas figures beside them are pinned by execution, in `routes-nest-dynamic.e2e.test.ts`.
  const PORTAL = "0x2222222222222222222222222222222222222222" as const;
  const options = (extra: Partial<IntentOptions> = {}): IntentOptions => ({
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: CREATOR,
    prover: CREATOR,
    ...extra,
  });
  const calls = (extra: Partial<IntentOptions> = {}) =>
    openRoute("ethereum", "return 1n;", options(extra)).reward(0n).intent.route.calls;
  const deployCall = v12Kitchen.encodeDeployPot(ecoRoutesExecutorOf(PORTAL), SAUCE_INTENT_POT_SALT);

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      documented: "**A derived Pot is deployed by the route that uses it.**",
      holds: () =>
        denormalizeToEvm(calls()[0]!.target) === v12GateKitchen().toLowerCase() &&
        calls()[0]!.data === deployCall,
    },
    {
      documented: "ahead of any precall",
      holds: () => calls({ precalls: [{ target: PORTAL, data: "0x12" }] })[0]!.data === deployCall,
    },
    {
      // The owner is the RECORDED Portal's Executor, which the deploy call names.
      documented: "**`executor()` of the Portal the route records**",
      holds: () =>
        calls()[0]!.data.toLowerCase().includes(ecoRoutesExecutorOf(PORTAL).slice(2).toLowerCase()),
    },
    {
      documented: "**A Pot you name gets no such call**",
      holds: () => calls({ pot: PORTAL }).length === 1,
    },
    {
      documented: "`destinationPot(Base.chain, { portal })` returns that address",
      holds: () =>
        denormalizeToEvm(calls()[1]!.target) ===
        destinationPot("ethereum", { portal: PORTAL }).toLowerCase(),
    },
  ];

  it.each(CLAIMS.map((c) => [c.documented, c] as const))("the guide says %s", (_name, claim) => {
    expect(GUIDE).toContain(claim.documented);
  });

  it.each(CLAIMS.map((c) => [c.documented, c] as const))("and it holds: %s", (_name, claim) => {
    expect(claim.holds()).toBe(true);
  });

  it("no longer claims what stopped being true", () => {
    for (const retired of [
      // A derived Pot no longer waits for someone else to deploy it.
      "Before that, a cook against it reverts",
      // The TypeScript builder derives the Pot now, like the native syntax.
      "custody decision worth making explicitly",
      "is still supplied by the caller on this path",
    ]) {
      expect(GUIDE).not.toContain(retired);
    }
  });
});
