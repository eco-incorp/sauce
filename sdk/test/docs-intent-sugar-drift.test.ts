/**
 * The manual's "What is refused" list, pinned to what compiling an intent in the Portal form
 * refuses: the compiler's own errors, and the intent host's (`src/routes/intent-host.ts`).
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

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;
/** A top-level intent's creator, as a wallet publishing it: each refusal below is reached past it. */
const PUBLISHED = { deadline: 4_000_000_000n, publisher: CREATOR };

/** `program` compiled for Base: the intents it opens. */
const lower = (
  program: string,
  intents: Record<string, unknown> = PUBLISHED,
  defines: Record<string, bigint> = {},
) => compileSauceProgram("base", program, { defines: { RECIPIENT, ...defines }, intents }).intents;

const wrap = (
  body: string,
  reward = "{ token: USDC, amount }",
  chain = "Arbitrum",
  steps = ".receive({ token: USDC, amount })",
) =>
  `function main() {\n  const amount = 5;\n  ${chain}.Portal.send(${reward})${steps}.then(() => {\n    ${body}\n  });\n}`;

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
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", "{ token: USDC }")),
    message: /each item `\.send\(\.\.\.\)` takes is `\{ token, amount \}`/,
  },
  {
    documented: "item that is not an object written in place",
    trigger: () =>
      lower(
        `function main() {\n  const amount = 5;\n  const items = [{ token: USDC, amount }];\n  Arbitrum.Portal.send(items).receive({ token: USDC, amount }).then(() => {\n    USDC.transfer(RECIPIENT, amount);\n  });\n}`,
      ),
    message:
      /a value the host binds at this site must be a number, an address, a bool or a literal/,
  },
  {
    documented: "a `{ native }` item in `.receive(...)`",
    trigger: () =>
      lower(
        wrap("USDC.transfer(RECIPIENT, amount);", undefined, "Arbitrum", ".receive({ native: 1 })"),
      ),
    message: /`\.receive\(\.\.\.\)` names tokens: the native coin is paid with `\.send\(\.\.\.\)`/,
  },
  {
    documented: "an empty `.send([])`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", "[]")),
    message: /an array literal must have at least one element/,
  },
  {
    documented: "one used as a value",
    trigger: () =>
      lower(
        `function main() {\n  const opened = Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive({ token: USDC, amount: 1 }).then(() => {\n    USDC.transfer(RECIPIENT, 1);\n  });\n}`,
      ),
    message: /produces no value, so its result can't be used as one/,
  },
  {
    documented: "with steps out of order",
    trigger: () =>
      lower(
        wrap(
          "USDC.transfer(RECIPIENT, amount);",
          undefined,
          "Arbitrum",
          ".salt(1).receive({ token: USDC, amount })",
        ),
      ),
    message: /`Sent` has no method `salt`/,
  },
  {
    documented: "a modifier given twice or after the wrong step",
    trigger: () =>
      lower(
        wrap(
          "USDC.transfer(RECIPIENT, amount);",
          undefined,
          "Arbitrum",
          ".receive({ token: USDC, amount }).deadline(1).deadline(2)",
        ),
      ),
    message: /`\.deadline\(\.\.\.\)` is given twice after `\.receive\(\.\.\.\)`/,
  },
  {
    documented: "no `.receive(...)`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", undefined, "Arbitrum", "")),
    message: /stops before `\.receive\(\.\.\.\)`, which every intent has/,
  },
  {
    documented: "or no `.then(() => { ... })`",
    trigger: () =>
      lower(
        `function main() {\n  Arbitrum.Portal.send({ token: USDC, amount: 1 }).receive({ token: USDC, amount: 1 });\n}`,
      ),
    message: /has no body\. Finish it with `\.then/,
  },
  {
    documented: "A missing refundee",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);"), { deadline: 1n }),
    message: /needs `\.refundee\(<address>\)`.*may be shared/,
  },
  {
    documented: "missing fee for a program body",
    trigger: () =>
      lower(wrap("const held = USDC.balanceOf(ctx.self());\n    USDC.transfer(RECIPIENT, held);")),
    message: /its cook must pay that chain's Kitchen fee/,
  },
  {
    documented: "a `.fee(...)` the program computes",
    trigger: () =>
      lower(
        wrap(
          "const held = USDC.balanceOf(ctx.self());\n    USDC.transfer(RECIPIENT, held);",
          undefined,
          "Arbitrum",
          ".receive({ token: USDC, amount }).fee(ctx.timestamp())",
        ),
      ),
    message: /`\.fee\(\.\.\.\)` is the destination Kitchen's fee, which the intent is built with/,
  },
  {
    documented: "A chain with no eco-routes deployment",
    trigger: () =>
      lower(
        `function main() {\n  Zora.Portal.send({ token: USDC, amount: 5 }).receive().then(() => {\n    Token(0x7777777777777777777777777777777777777777).transfer(RECIPIENT, 5);\n  });\n}`,
      ),
    message: /eco-routes v3 is not deployed on zora/,
  },
  {
    documented: "A program body that calls the function opening it",
    trigger: () =>
      lower(
        `function payout(amount: Uint256) {
  Arbitrum.Portal.send({ token: USDC, amount }).receive({ token: USDC, amount }).then(() => {
    if (amount > 0) { payout(amount); }
  });
}
function main() {
  payout(5);
}`,
        { ...PUBLISHED, executionFee: 0n },
      ),
    message: /contains itself: a function it calls passes it to `Received\.then` again/,
  },
];

describe("the guide's refusal list is the lowering's", () => {
  it.each(REFUSALS.map((r) => [r.documented, r] as const))(
    "the guide documents %s",
    (_name, refusal) => {
      expect(GUIDE.replace(/\s+/g, " ")).toContain(refusal.documented);
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
      // Deadlines have defaults since the Portal form.
      "A missing `deadline`",
      // The compiler reads a module variable where it lives, however a local of the function
      // opening the intent is named.
      "A program body using a module variable that a local of the opening function shadows",
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
      'require(amount > 0, "nothing delivered");',
    ]) {
      expect(GUIDE.replace(/\s+/g, " ")).toContain(claim);
    }
    // The guide's statement makes the body a program: lowered with no fee, it asks for one.
    expect(() =>
      lower(
        wrap('require(amount > 0, "nothing delivered");\n    USDC.transfer(RECIPIENT, amount);'),
      ),
    ).toThrow(/its cook must pay that chain's Kitchen fee/);
  });
});

describe("the guide's account of which chain a name resolves on is the lowering's", () => {
  // Base's USDC and Arbitrum's are different addresses, so each part's chain shows in the address
  // it names. Executed across three chains in `routes-intent-chains.e2e.test.ts`.
  const PROGRAM = `function main() {
  const amount = 5;
  Arbitrum.Portal.send({ token: USDC, amount })
    .receive({ token: USDC, amount })
    .then(() => {
      USDC.transfer(RECIPIENT, amount);
    });
}`;
  const lowered = (defines: Record<string, bigint> = {}) =>
    lower(PROGRAM, PUBLISHED, defines)[0]!.intent;
  const word = (address: bigint) => `0x${"00".repeat(12)}${address.toString(16).padStart(40, "0")}`;
  const onChain = (chain: typeof BASE) => word(registryTokenAddress(chain, "USDC")!);
  const guide = GUIDE.replace(/\s+/g, " ");

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      documented: "| The body, `.then(() => { ... })` | Arbitrum, the destination | Arbitrum's |",
      holds: () => lowered().route.calls[0]!.target === onChain(ARBITRUM),
    },
    {
      documented: "| `.receive(...)`, what is delivered | Arbitrum, the destination | Arbitrum's |",
      holds: () => lowered().route.tokens[0]!.token === onChain(ARBITRUM),
    },
    {
      documented:
        "| `.send(...)` and every modifier | The chain the program runs on | That chain's |",
      holds: () => lowered().reward.tokens[0]!.token === onChain(BASE),
    },
    {
      // A caller's `USDC` is Base's: the reward pays in it, while the Arbitrum body keeps
      // Arbitrum's registry USDC.
      documented: "is a name on the chain the program is compiled for",
      holds: () => {
        const chosen = 0x7777777777777777777777777777777777777777n;
        const intent = lowered({ USDC: chosen });
        return (
          intent.reward.tokens[0]!.token === word(chosen) &&
          intent.route.calls[0]!.target === onChain(ARBITRUM)
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
    JSON.stringify(
      lower(
        `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.Portal.send({ token: USDC, amount })
    .receive({ token: USDC, amount })
    .then(() => {
      if (amount > 0) { USDC.transfer(RECIPIENT, amount); }
    });
}`,
        { ...PUBLISHED, executionFee: 0n },
      )[0]!.intent.route.calls,
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    ).toLowerCase();

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
    expect(GUIDE.replace(/\s+/g, " ")).toContain(claim.documented);
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
