/**
 * `.nest(child, { via: "dynamic", … })` — the DSL surface over `nest-dynamic.ts`.
 *
 * Companion to `routes-nest-transfer-dsl.test.ts` (the `"transfer"` default) and
 * `routes-nest-dsl.test.ts` (`"publishAndFund"`). What is specific to this mode: the child carries
 * SENTINELS rather than amounts, so it must survive `assertNestingInvariants` (which reads a child's
 * amounts as numbers in two of its six checks) and reach a compiled cook whose bytecode carries the
 * child's own calldata as literal runs.
 *
 * Everything here is build-time. Nothing executes — see `routes-nest-dynamic.test.ts`'s header for
 * what that does and does not establish.
 */
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from "viem";

import { v12Pot } from "../src/evm/engine.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import {
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER,
  dynamicChildTemplate,
} from "../src/routes/nest-dynamic.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import type { BuiltIntent } from "../src/routes/intent-dsl.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x5555555555555555555555555555555555555555" as const;
const RECIPIENT = "0x9999999999999999999999999999999999999999" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: 2000n,
    ...overrides,
  };
}

/** A child whose escrow is `amountIn` and whose delivery obligation — both the `route.tokens` entry
 *  the solver must post and the `transfer` it must make — is `amountOut`. Nothing here is a number
 *  the caller knows; all three are sentinels until the parent runs. */
function templatedChild(destination = "arbitrum", source = "base"): BuiltIntent {
  return openRoute(destination, "return 1n;", {
    ...evmOptions({ source }),
    tokens: [{ token: TOKEN, amount: AMOUNT_OUT_PLACEHOLDER }],
    precalls: [
      {
        target: TOKEN,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [RECIPIENT, AMOUNT_OUT_PLACEHOLDER],
        }),
      },
    ],
  }).reward({ tokens: [{ token: TOKEN, amount: AMOUNT_IN_PLACEHOLDER }] });
}

const PLACEHOLDERS = [
  { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn" as const, occurrences: 1 },
  { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut" as const, occurrences: 2 },
];

/** For a child whose only `amountOut` site is its own `route.tokens` entry. */
const PLACEHOLDERS_ONE_EACH = [
  { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn" as const, occurrences: 1 },
  { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut" as const, occurrences: 1 },
];

function callKinds(calls: readonly { data: Hex }[]): readonly string[] {
  return calls.map((c) => {
    try {
      return decodeFunctionData({ abi: PortalABI, data: c.data }).functionName;
    } catch {
      // not a Portal call
    }
    try {
      decodeFunctionData({ abi: v12Pot.abi, data: c.data });
      return "cook";
    } catch {
      return "unknown";
    }
  });
}

describe(".nest(): via 'dynamic' produces one extra cook, not a pre-encoded publishAndFund", () => {
  it("adds exactly one cook after the body's own, and no Portal call in route.calls", () => {
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(templatedChild(), {
        via: "dynamic",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS,
      })
      .reward(0n);

    const kinds = callKinds(built.intent.route.calls);
    expect(kinds).toEqual(["cook", "cook"]);
    // The child's publishAndFund exists only INSIDE the second cook's bytecode -- it is never a
    // `route.calls` entry the way a static child's is.
    expect(kinds).not.toContain("publishAndFund");
  });

  it("the cook's bytecode carries the child's calldata as literal runs", () => {
    const child = templatedChild();
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(child, {
        via: "dynamic",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS,
      })
      .reward(0n);

    const cook = built.intent.route.calls.at(-1)!;
    const { segments } = dynamicChildTemplate(child.intent, {
      portal: PORTAL,
      measure: { kind: "erc20Balance", token: TOKEN },
      placeholders: PLACEHOLDERS,
    });

    for (const segment of segments) {
      if (segment === "0x") continue;
      expect(cook.data.toLowerCase()).toContain(segment.slice(2).toLowerCase());
    }
  });

  it("the child is reachable on the built intent, and intents() walks it", () => {
    const child = templatedChild();
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(child, {
        via: "dynamic",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS,
      })
      .reward(0n);

    expect(built.children).toHaveLength(1);
    expect(built.intents()).toHaveLength(2);
    expect(built.intents()[1]).toBe(child.intent);
  });

  it("a route with no parent reward tokens still nests — funding is the runtime measurement", () => {
    // Invariant 5 would reject this child under `publishAndFund`: its reward names a ~1.5e77 amount
    // the parent's (empty) route.tokens cannot cover.
    expect(() =>
      openRoute("base", "return 1n;", evmOptions({ tokens: [] }))
        .nest(templatedChild(), {
          via: "dynamic",
          measure: { kind: "erc20Balance", token: TOKEN },
          placeholders: PLACEHOLDERS,
        })
        .reward(0n),
    ).not.toThrow();
  });
});

describe(".nest(): via 'dynamic' option gating", () => {
  it("requires `measure` — it has no safe default", () => {
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(templatedChild(), { via: "dynamic" }),
    ).toThrow(/requires `measure`/);
  });

  it("rejects a transfer-only option, naming the modes it IS valid under", () => {
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(templatedChild(), {
        via: "dynamic",
        measure: { kind: "nativeBalance" },
        clamp: true,
      }),
    ).toThrow(/option 'clamp' is only valid with via: "transfer"/);
  });

  it("rejects a dynamic-only option under another mode", () => {
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(templatedChild(), {
        via: "publishAndFund",
        measure: { kind: "nativeBalance" },
      }),
    ).toThrow(/option 'measure' is only valid with via: "dynamic"/);
    expect(() =>
      openRoute("base", "return 1n;", evmOptions()).nest(templatedChild(), { scale: 1n }),
    ).toThrow(/option 'scale' is only valid with via: "dynamic"/);
  });

  it("shares `allowPartial` with publishAndFund and the cook plumbing with transfer", () => {
    const measure = { kind: "erc20Balance", token: TOKEN } as const;
    expect(() =>
      openRoute("base", "return 1n;", evmOptions())
        .nest(templatedChild(), {
          via: "dynamic",
          measure,
          placeholders: PLACEHOLDERS,
          allowPartial: true,
          executionFee: 0n,
          pot: POT,
          engine: ENGINE,
        })
        .reward(0n),
    ).not.toThrow();
  });

  it("T3: a Solana destination has no Pot to run the renderer on", () => {
    // A child of an SVM-destination route sources from "solana" -- its parent's destination.
    expect(() =>
      openRoute("solana", "return 1n;", {
        execution: { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: CREATOR,
        prover: PROVER,
        rewardDeadline: 2000n,
      }).nest(templatedChild("arbitrum", "solana"), {
        via: "dynamic",
        measure: { kind: "nativeBalance" },
      }),
    ).toThrow(/via: "dynamic" requires an EVM Pot execution \(T3\)/);
  });
});

describe(".nest(): mixing modes in one position group", () => {
  it("orders the group publishAndFund calls, then the transfer cook, then the dynamic cook", () => {
    const staticChild = (salt: string) =>
      openRoute(
        "arbitrum",
        "return 1n;",
        evmOptions({ salt: `0x${salt.repeat(32)}` as Hex }),
      ).reward({ tokens: [{ token: TOKEN, amount: 5n }] });
    const built = openRoute(
      "base",
      "return 1n;",
      evmOptions({ tokens: [{ token: TOKEN, amount: 5n }] }),
    )
      // Deliberately nested in the OPPOSITE order to the one they must come out in.
      .nest(templatedChild(), {
        via: "dynamic",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS,
      })
      .nest(staticChild("aa"), { via: "transfer", vault: RECIPIENT })
      .nest(staticChild("bb"), { via: "publishAndFund" })
      .reward(0n);

    // body cook, then approve + publishAndFund, then the transfer cook, then the dynamic cook.
    expect(callKinds(built.intent.route.calls)).toEqual([
      "cook",
      "unknown", // the ERC20 approve the publishAndFund child needs
      "publishAndFund",
      "cook",
      "cook",
    ]);
  });

  it("merges several dynamic children in one group into ONE cook", () => {
    const measure = { kind: "erc20Balance", token: TOKEN } as const;
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(templatedChild("arbitrum"), { via: "dynamic", measure, placeholders: PLACEHOLDERS })
      .nest(templatedChild("optimism"), { via: "dynamic", measure, placeholders: PLACEHOLDERS })
      .reward(0n);

    expect(callKinds(built.intent.route.calls)).toEqual(["cook", "cook"]);
    expect(built.children).toHaveLength(2);
  });

  it("a `position: 'before'` dynamic child runs ahead of the body's own cook", () => {
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest(templatedChild(), {
        via: "dynamic",
        position: "before",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS,
      })
      .reward(0n);

    const [first, second] = built.intent.route.calls;
    // Both are cooks; the dynamic one is the LONGER payload (it carries the child's calldata).
    expect(callKinds([first!, second!])).toEqual(["cook", "cook"]);
    expect(first!.data.length).toBeGreaterThan(second!.data.length);
  });
});

describe(".nest(): a dynamic child that itself nests a dynamic child", () => {
  /** Depth 2 through the fluent API alone: Base -> Arbitrum -> Optimism, with no amount below the
   *  first known when the parent is built. Each level is the SAME construct — there is no special
   *  "middle" form — which is what makes depth N follow from depth 2. */
  const cascade = () => {
    const measureOnArbitrum = { kind: "erc20Balance", token: TOKEN } as const;

    const grandchild = openRoute("optimism", "return 1n;", {
      ...evmOptions({ source: "arbitrum" }),
      salt: `0x${"9c".repeat(32)}` as Hex,
      tokens: [{ token: TOKEN, amount: AMOUNT_OUT_PLACEHOLDER }],
    }).reward({ tokens: [{ token: TOKEN, amount: AMOUNT_IN_PLACEHOLDER }] });

    const child = openRoute("arbitrum", "return 1n;", {
      ...evmOptions({ source: "base" }),
      salt: `0x${"9b".repeat(32)}` as Hex,
      tokens: [{ token: TOKEN, amount: AMOUNT_OUT_PLACEHOLDER }],
    })
      .nest(grandchild, {
        via: "dynamic",
        measure: measureOnArbitrum,
        placeholders: PLACEHOLDERS_ONE_EACH,
      })
      .reward({ tokens: [{ token: TOKEN, amount: AMOUNT_IN_PLACEHOLDER }] });

    return openRoute("base", "return 1n;", evmOptions())
      .nest(child, {
        via: "dynamic",
        measure: { kind: "erc20Balance", token: TOKEN },
        placeholders: PLACEHOLDERS_ONE_EACH,
      })
      .reward(0n);
  };

  it("the API expresses it directly — nothing special is needed at the middle level", () => {
    expect(cascade).not.toThrow();
  });

  it("walks three intents, and the parent's cook carries the child's rendered segments", () => {
    const built = cascade();

    expect(built.intents()).toHaveLength(3);
    const cook = built.intent.route.calls.at(-1)!;
    const { segments } = dynamicChildTemplate(built.children[0]!.intent, {
      portal: PORTAL,
      measure: { kind: "erc20Balance", token: TOKEN },
      placeholders: PLACEHOLDERS_ONE_EACH,
    });
    for (const segment of segments) {
      if (segment === "0x") continue;
      expect(cook.data.toLowerCase()).toContain(segment.slice(2).toLowerCase());
    }
  });

  it("the grandchild's own cook is inside the child's route, untouched by the parent", () => {
    const built = cascade();
    const child = built.children[0]!;
    // The child carries its own extra cook -- the grandchild's renderer -- and the parent spliced
    // amounts around it without disturbing it.
    expect(child.intent.route.calls).toHaveLength(2); // the child's body cook + the grandchild's
    expect(child.children).toHaveLength(1);
  });
});
