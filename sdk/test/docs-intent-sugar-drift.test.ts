/**
 * The manual's "What is refused" list, pinned to what compiling a hop
 * refuses: the compiler's own errors, and `@sauce/hop`'s (`src/std/hop/hop.evm.js`).
 * And its account of which chain each name resolves on, and of the destination Pot, held to what the
 * compile builds: the program, and the body it compiles for each destination, carry the addresses.
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
/** The intents' deadline and fee: each refusal below is reached past them. */
const INTENTS = { deadline: 4_000_000_000n, executionFee: 0n };

/** `program` compiled for Base. */
const lower = (
  program: string,
  intents: Record<string, unknown> = INTENTS,
  defines: Record<string, bigint> = {},
) => compileSauceProgram("base", program, { defines: { RECIPIENT, ...defines }, intents });

const wrap = (
  body: string,
  reward = "{ token: USDC, amount }",
  chain = "Arbitrum",
  fields = `, receive: { token: USDC, amount }, refundee: ${CREATOR}`,
) =>
  `function main() {\n  const amount = 5;\n  ${chain}.hop({ send: ${reward}${fields} }).then(() => {\n    ${body}\n  });\n}`;

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
    documented: "A hop with no body",
    trigger: () =>
      lower(
        `function main() {\n  Arbitrum.hop({ send: { token: USDC, amount: 1 }, receive: { token: USDC, amount: 1 }, refundee: ${CREATOR} });\n}`,
      ),
    message: /has no body\. Finish it with `\.then/,
  },
  {
    documented: "a step after the wrong one",
    trigger: () =>
      lower(
        `function main() {\n  Arbitrum.hop({ send: { token: USDC, amount: 1 }, refundee: ${CREATOR} }).catch((e) => {});\n}`,
      ),
    message: /`\.catch\(\.\.\.\)` follows `\.then\(\.\.\.\)`/,
  },
  {
    documented: "A hop with no `send`",
    trigger: () =>
      lower(
        `function main() {\n  Arbitrum.hop({ refundee: ${CREATOR} }).then(() => {\n    USDC.transfer(RECIPIENT, 1);\n  });\n}`,
      ),
    message: /a hop needs a `send`/,
  },
  {
    documented: "an empty `send: []`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", "[]")),
    message: /a hop's `send` must offer something/,
  },
  {
    documented: "an item missing `token` or `amount`",
    trigger: () => lower(wrap("USDC.transfer(RECIPIENT, amount);", "{ token: USDC }")),
    message: /each item of a hop's `send` is `\{ token, amount \}`/,
  },
  {
    documented: "a `{ native }` item in `receive`",
    trigger: () =>
      lower(
        wrap(
          "USDC.transfer(RECIPIENT, amount);",
          undefined,
          "Arbitrum",
          `, receive: { native: 1 }, refundee: ${CREATOR}`,
        ),
      ),
    message: /a hop's `receive` names tokens: the native coin is paid in its `send`/,
  },
  {
    documented: "A missing refundee",
    trigger: () =>
      lower(
        wrap(
          "USDC.transfer(RECIPIENT, amount);",
          undefined,
          "Arbitrum",
          ", receive: { token: USDC, amount }, fee: 1",
        ),
      ),
    message: /a hop needs a `refundee`.*may be shared/,
  },
  {
    documented: "missing fee for a program body",
    trigger: () =>
      lower(wrap("const held = USDC.balanceOf(ctx.self());\n    USDC.transfer(RECIPIENT, held);"), {
        deadline: INTENTS.deadline,
      }),
    message: /its cook must pay that chain's Kitchen fee/,
  },
  {
    documented: "A chain with no eco-routes deployment",
    trigger: () =>
      lower(
        `function main() {\n  Zora.hop({ send: { token: USDC, amount: 5 } }).then(() => {\n    Token(0x7777777777777777777777777777777777777777).transfer(RECIPIENT, 5);\n  });\n}`,
      ),
    message: /eco-routes v3 is not deployed on zora/,
  },
  {
    documented: "A program body that calls the function opening it",
    trigger: () =>
      lower(
        `function payout(amount: Uint256) {
  Arbitrum.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: ${CREATOR} }).then(() => {
    if (amount > 0) { payout(amount); }
  });
}
function main() {
  payout(5);
}`,
        INTENTS,
      ),
    message: /contains itself: a function it calls compiles the same closure again/,
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
      // Deadlines have defaults since the chained intent form.
      "A missing `deadline`",
      // The compiler reads a module variable where it lives, however a local of the function
      // opening the intent is named.
      "A program body using a module variable that a local of the opening function shadows",
    ]) {
      expect(GUIDE).not.toContain(lifted);
    }
  });

  it("documents that every body is a program, and what it costs", () => {
    for (const claim of [
      "a program compiled for the destination",
      "destinationExecutionFee",
      "one shared Pot per Executor",
      "leave nothing in it",
      "a token transfer alone included",
    ]) {
      expect(GUIDE.replace(/\s+/g, " ")).toContain(claim);
    }
    // A body of one transfer is a program too: lowered with no fee, it asks for one.
    expect(() =>
      lower(wrap("USDC.transfer(RECIPIENT, amount);"), { deadline: INTENTS.deadline }),
    ).toThrow(/its cook must pay that chain's Kitchen fee/);
  });

  it("no longer documents a body the Executor runs without a Pot", () => {
    for (const retired of [
      "A token-only body is not a Sauce program",
      "only token `transfer`/`approve`",
      "Token-only bodies run on the Executor",
      "`publisher`",
    ]) {
      expect(GUIDE).not.toContain(retired);
    }
  });
});

describe("the guide's account of which chain a name resolves on is the lowering's", () => {
  // Base's USDC and Arbitrum's are different addresses, so each part's chain shows in the address
  // it names. Executed across three chains in `routes-intent-chains.e2e.test.ts`.
  const PROGRAM = `function main() {
  const amount = 5;
  Arbitrum.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: ${CREATOR} })
    .then(() => {
      USDC.transfer(RECIPIENT, amount);
    });
}`;
  const lowered = (defines: Record<string, bigint> = {}) =>
    lower(PROGRAM, { ...INTENTS, executionFee: 0n }, defines);
  /** Whether `bytes` carry `address`. */
  const carries = (bytes: Uint8Array, address: bigint) =>
    Buffer.from(bytes).toString("hex").includes(address.toString(16).padStart(40, "0"));
  const usdc = (chain: typeof BASE) => registryTokenAddress(chain, "USDC")!;
  const guide = GUIDE.replace(/\s+/g, " ");

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      documented:
        "| The body, what follows `await` or `.then(() => { ... })` | Arbitrum, the destination | Arbitrum's |",
      holds: () => {
        const [body] = lowered().bodies;
        return (
          body?.destination.slug === "arbitrum" &&
          carries(body.bytecode, usdc(ARBITRUM)) &&
          !carries(body.bytecode, usdc(BASE))
        );
      },
    },
    {
      // The route delivers Arbitrum's USDC: the program encodes it, and moves it into the Pot.
      documented:
        "| `receive`, what is delivered | The chain the program runs on | Arbitrum's: a token is looked up again |",
      holds: () => carries(lowered().bytecode, usdc(ARBITRUM)),
    },
    {
      documented: "| `send` and every other field | The chain the program runs on | That chain's |",
      holds: () => carries(lowered().bytecode, usdc(BASE)),
    },
    {
      // A caller's `USDC` is Base's: the reward pays in it, while the Arbitrum body keeps
      // Arbitrum's registry USDC.
      documented: "is a name on the chain the program is compiled for",
      holds: () => {
        const chosen = 0x7777777777777777777777777777777777777777n;
        const program = lowered({ USDC: chosen });
        return (
          carries(program.bytecode, chosen) &&
          !carries(program.bytecode, usdc(BASE)) &&
          carries(program.bodies[0]!.bytecode, usdc(ARBITRUM))
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
  // `routes-intent-bodies.e2e.test.ts`.
  const PORTAL = "0x2222222222222222222222222222222222222222" as const;
  const NAMED = "0x7777777777777777777777777777777777777777" as const;
  const sharedPot = v12PredictPot(ecoRoutesExecutorOf(PORTAL));
  const deploySelector = v12Kitchen
    .encodeDeployPot(ecoRoutesExecutorOf(PORTAL), SAUCE_INTENT_POT_SALT)
    .slice(2, 10);
  const programChild = (intents: Record<string, unknown> = {}) =>
    Buffer.from(
      lower(
        `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: ${CREATOR} })
    .then(() => {
      if (amount > 0) { USDC.transfer(RECIPIENT, amount); }
    });
}`,
        { ...INTENTS, executionFee: 0n, destinationPortal: PORTAL, ...intents },
      ).bytecode,
    ).toString("hex");
  const carries = (hex: string, address: string) => hex.includes(address.slice(2).toLowerCase());

  const CLAIMS: readonly { readonly documented: string; readonly holds: () => boolean }[] = [
    {
      // The route the program writes: the delivery and the cook, and nothing that deploys.
      documented: "**The destination Pot must exist before the intent is fulfilled.**",
      holds: () =>
        !programChild().includes(deploySelector) && !carries(programChild(), v12KitchenAddress()),
    },
    {
      // The native syntax: the child's encoded route carries no deployment either.
      documented: "and the lowering deploys nothing",
      holds: () => !programChild().includes(deploySelector),
    },
    {
      // The owner is the RECORDED Portal's Executor.
      documented: "**`executor()` of the Portal the route records**",
      holds: () => carries(programChild(), getAddress(sharedPot)),
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
        carries(programChild({ pot: NAMED }), NAMED) &&
        !carries(programChild({ pot: NAMED }), getAddress(sharedPot)),
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
