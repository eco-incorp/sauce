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

import { getAddress } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { v12KitchenAddress } from "../src/deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { v12Kitchen } from "../src/evm/engine.js";
import { ecoRoutesExecutorOf } from "../src/protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../src/routes/encode.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const GUIDE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/guides/intents.md"),
  "utf8",
);

const ARBITRUM = requireChain("arbitrum");
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;

/** `program` compiled for Base, with every intent option a refusal below does not take away. */
const lower = (
  program: string,
  intents: Record<string, unknown> = { deadline: 4_000_000_000n, creator: CREATOR },
) => compileSauceProgram("base", program, { defines: { RECIPIENT }, intents });

const wrap = (body: string, reward = "[{ token: USDC, amount }]", chain = "Arbitrum") =>
  `function main() {\n  const amount = 5n;\n  ${chain}.Portal.send(${reward}).then(() => {\n    ${body}\n  });\n}`;

/** Documented sentence -> the program that must produce it. */
const REFUSALS: readonly {
  readonly documented: string;
  readonly trigger: () => unknown;
  readonly message: RegExp;
}[] = [
  {
    documented: "neither a compile-time value nor a variable of the enclosing program",
    trigger: () => lower(wrap("USDC.transfer(mystery, amount);")),
    message: /`mystery` is not a declared variable/,
  },
  {
    documented: "a token entry missing `token` or `amount`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", "[{ token: USDC }]")),
    message: /takes is `\{ token, amount \}`/,
  },
  {
    documented: "A missing `deadline`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);"), {}),
    message: /needs a `deadline`/,
  },
  {
    documented: "a missing `creator`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);"), { deadline: 1n }),
    message: /needs a `creator`/,
  },
  {
    documented: "A chain with no eco-routes deployment",
    trigger: () =>
      lower(
        wrap(
          "Token(0x7777777777777777777777777777777777777777).transfer(RECIPIENT, amount);",
          undefined,
          "Zora",
        ),
      ),
    message: /eco-routes v3 is not deployed on zora/,
  },
  {
    documented: "A program body that calls the function opening it",
    trigger: () =>
      lower(
        `function payout(amount: Uint256) {
  Arbitrum.Portal.send([{ token: USDC, amount }]).then(() => {
    if (amount > 0n) { payout(amount); }
  });
}
function main() {
  payout(5n);
}`,
        { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n },
      ),
    message: /contains itself/,
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
      "one shared Pot per Executor",
      "leave nothing in it",
    ]) {
      expect(GUIDE).toContain(claim);
    }
  });

  it("documents what the Executor path does with USDT and with a `false` return", () => {
    // The lowering's reset and the gap it leaves are unit-tested in `routes-intent-sugar.test.ts`
    // and executed through a real Executor in `routes-nest-dynamic.e2e.test.ts`.
    for (const claim of [
      "A token-only body is not a Sauce program",
      "`approve(spender, 0)` and then `approve(spender, amount)`",
      "A token that returns `false` instead of reverting is not detected",
      "const held = USDC.balanceOf(ctx.self());",
    ]) {
      expect(GUIDE.replace(/\s+/g, " ")).toContain(claim);
    }
  });
});

describe("the guide's account of which chain a name resolves on is the lowering's", () => {
  // The real registry, where USDC is a different address on each chain, so each part's chain shows
  // in the address it names. Executed across three chains in `routes-intent-chains.e2e.test.ts`.
  const lowered = () =>
    lower(`function main() {
  const amount = 5n;
  Arbitrum.Portal.send([{ token: USDC, amount }]).receive([{ token: USDC, amount }]).then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
}`).intents[0]!.intent;
  const onChain = (slug: string) =>
    `0x${"00".repeat(12)}${registryTokenAddress(requireChain(slug), "USDC")!.toString(16).padStart(40, "0")}`;
  const guide = GUIDE.replace(/\s+/g, " ");

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      documented: "| `.then(...)`'s braces | Arbitrum, the destination | Arbitrum's |",
      holds: () => lowered().route.calls[0]!.target === onChain(ARBITRUM.slug),
    },
    {
      documented: "| `.receive(...)`, what is delivered | Arbitrum, the destination | Arbitrum's |",
      holds: () => lowered().route.tokens[0]!.token === onChain(ARBITRUM.slug),
    },
    {
      documented: "| `.send(...)`, the reward | The chain the program runs on | That chain's |",
      holds: () => lowered().reward.tokens[0]!.token === onChain("base"),
    },
    {
      // A caller's `USDC` is Base's: the reward it escrows, while the Arbitrum body keeps Arbitrum's
      // registry USDC.
      documented: "is a name on the chain the program is compiled for",
      holds: () => {
        const chosen = 0x7777777777777777777777777777777777777777n;
        const [intent] = compileSauceProgram(
          "base",
          `function main() {
  const amount = 5n;
  Arbitrum.Portal.send([{ token: USDC, amount }]).then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
}`,
          {
            defines: { USDC: chosen, RECIPIENT: 1n },
            intents: { deadline: 4_000_000_000n, creator: CREATOR },
          },
        ).intents;
        return (
          BigInt(intent!.intent.reward.tokens[0]!.token) === chosen &&
          intent!.intent.route.calls[0]!.target === onChain(ARBITRUM.slug)
        );
      },
    },
  ];

  it.each(CLAIMS.map((c) => [c.documented, c] as const))("the guide says %s", (_name, claim) => {
    expect(guide).toContain(claim.documented);
  });

  it.each(CLAIMS.map((c) => [c.documented, c] as const))("and it holds: %s", (_name, claim) => {
    expect(claim.holds()).toBe(true);
  });

  it("no longer says every name inside the intent is the destination's", () => {
    expect(guide).not.toContain("Resolving it against the enclosing chain would put");
  });

  it("a body reading a module variable that a local of the opening function shadows compiles", () => {
    // It used to be refused: the two `total`s are now each read from where they live.
    expect(() =>
      lower(
        `let total = 0n;
function half(): Uint256 {
  return total / 2n;
}
function main() {
  const total = 5n;
  Arbitrum.Portal.send([{ token: USDC, amount: total }]).then(() => {
    if (half() > 0n) { USDC.transfer(RECIPIENT, total); }
  });
}`,
        { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n },
      ),
    ).not.toThrow();
    expect(GUIDE).not.toContain("a local of the opening function shadows");
  });
});

describe("the guide's account of the destination Pot is the builder's", () => {
  // Each claim is a sentence the guide must contain and a check on what the SDK builds. What the
  // chain does with it -- a missing Pot reverts, a present one cooks -- is executed in
  // `routes-nest-dynamic.e2e.test.ts`.
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
    openRoute("ethereum", "function main() { return 1n; }", options(extra)).reward(0n).intent.route
      .calls;
  const sharedPot = v12PredictPot(ecoRoutesExecutorOf(PORTAL));
  const deploySelector = v12Kitchen
    .encodeDeployPot(ecoRoutesExecutorOf(PORTAL), SAUCE_INTENT_POT_SALT)
    .slice(2, 10);
  const programChild = () =>
    compileSauceProgram(
      "base",
      `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.Portal.send([{ token: USDC, amount }]).receive([{ token: USDC, amount }]).then(() => {
    if (amount > 0n) { USDC.transfer(RECIPIENT, amount); }
  });
}`,
      {
        defines: { RECIPIENT: 0x9999999999999999999999999999999999999999n },
        intents: { deadline: 4_000_000_000n, creator: CREATOR, executionFee: 0n },
      },
    )
      .intents[0]!.intent.route.calls.map((call) => call.data)
      .join("")
      .toLowerCase();

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      // The TypeScript builder: the cook, and nothing that deploys.
      documented: "**The destination Pot must exist before the intent is fulfilled.**",
      holds: () =>
        calls().length === 1 &&
        calls().every(
          (c) =>
            denormalizeToEvm(c.target) !== v12KitchenAddress().toLowerCase() &&
            !c.data.startsWith(`0x${deploySelector}`),
        ),
    },
    {
      // The native syntax: the child's encoded route carries no deployment either.
      documented: "and the lowering deploys nothing",
      holds: () => !programChild().includes(deploySelector),
    },
    {
      // The owner is the RECORDED Portal's Executor.
      documented: "**`executor()` of the Portal the route records**",
      holds: () => getAddress(denormalizeToEvm(calls()[0]!.target)) === sharedPot,
    },
    {
      // The solver's own Pot: one per Portal, salt zero.
      documented: "salt zero (`SAUCE_INTENT_POT_SALT`)",
      holds: () => SAUCE_INTENT_POT_SALT === `0x${"00".repeat(32)}`,
    },
    {
      documented: "`destinationPot(Base.chain, { portal })` returns that address",
      holds: () => destinationPot("ethereum", { portal: PORTAL }) === sharedPot,
    },
    {
      documented: "instead must also exist, and be owned by that Executor",
      holds: () =>
        calls({ pot: PORTAL }).length === 1 &&
        denormalizeToEvm(calls({ pot: PORTAL })[0]!.target) === PORTAL,
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
      // Routes deploy nothing: the solver deploys the Pot before fulfilment.
      "Before that, a cook against it reverts",
      "A derived Pot is deployed by the route that uses it",
      "so the route deploys it",
      "gas for the no-op",
      "gas for a no-op",
      "Nobody has to",
      // The TypeScript builder derives the Pot, like the native syntax.
      "custody decision worth making explicitly",
      "is still supplied by the caller on this path",
    ]) {
      expect(GUIDE).not.toContain(retired);
    }
  });
});
