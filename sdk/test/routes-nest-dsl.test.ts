/**
 * `.nest()` on `PendingSauceRoute` + the `BuiltIntent` cascade surface (`intent-dsl.ts`).
 */
import { decodeFunctionData, type Hex } from "viem";

import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { hashIntent } from "../src/routes/encode.js";
import { PORTAL_ABI } from "../src/routes/portal.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: 1000n,
    ...overrides,
  };
}

/** An EVM-destination, EVM-source child spec — `source` is explicit since these tests exercise the
 *  BuiltIntent (not thunk) `.nest()` form. */
function childSpec(destination: string, deadline = 2000n, source = "base") {
  return openRoute(destination, "return 1n;", {
    pot: POT,
    deadline,
    portal: PORTAL,
    source,
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: deadline,
  });
}

describe(".nest(): thunk form", () => {
  it("receives the parent's CanonicalChain and needs no explicit source", () => {
    let seenParentSlug: string | undefined;
    const built = openRoute("base", "return 1n;", evmOptions())
      .nest((on) => {
        seenParentSlug = on.slug;
        return openRoute("arbitrum", "return 2n;", {
          pot: POT,
          deadline: 2000n,
          portal: PORTAL,
          source: on,
          creator: CREATOR,
          prover: PROVER,
          rewardDeadline: 2000n,
        }).reward(0n);
      })
      .reward(0n);

    expect(seenParentSlug).toBe("base");
    expect(built.children).toHaveLength(1);
    expect(built.children[0]!.source.slug).toBe("base");
    expect(built.children[0]!.destination.slug).toBe("arbitrum");
  });
});

describe(".nest(): BuiltIntent form", () => {
  it("throws when the child's source does not match the parent's destination", () => {
    const mismatchedChild = childSpec("optimism", 2000n, "base").reward(0n); // source: base
    expect(() =>
      openRoute("arbitrum", "return 1n;", evmOptions()).nest(mismatchedChild), // destination: arbitrum, not base
    ).toThrow(/source/i);
  });

  it("accepts a pre-built child whose source already matches the parent's destination", () => {
    const child = childSpec("optimism", 2000n, "base").reward(0n); // source: base
    expect(() => openRoute("base", "return 1n;", evmOptions()).nest(child).reward(0n)).not.toThrow();
  });
});

describe(".nest(): depth-2 cascade", () => {
  it("head -> child -> grandchild gives intents().length === 3 in pre-order with distinct hashes", () => {
    const grandchild = openRoute("solana", "return 3n;", {
      execution: {
        buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        accounts: [],
      },
      deadline: 3000n,
      portal: PORTAL,
      source: "arbitrum",
      creator: CREATOR,
      prover: PROVER,
      rewardDeadline: 3000n,
    }).reward(0n);

    const child = openRoute("arbitrum", "return 2n;", evmOptions({ deadline: 2000n, rewardDeadline: 2000n }))
      .nest(grandchild)
      .reward(0n);

    const head = openRoute("base", "return 1n;", evmOptions())
      .nest(child)
      .reward(0n);

    const intents = head.intents();
    expect(intents).toHaveLength(3);
    expect(intents[0]).toBe(head.intent);
    expect(intents[1]).toBe(child.intent);
    expect(intents[2]).toBe(grandchild.intent);

    const hashes = new Set(intents.map((i) => hashIntent(i).intentHash));
    expect(hashes.size).toBe(3);
  });
});

describe(".nest(): call ordering", () => {
  it("two children preserve .nest() order in route.calls", () => {
    const childA = childSpec("arbitrum").reward(0n);
    const childB = openRoute("solana", "return 1n;", {
      execution: { buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
      deadline: 2000n,
      portal: PORTAL,
      source: "base",
      creator: CREATOR,
      prover: PROVER,
      rewardDeadline: 2000n,
    }).reward(0n);

    const built = openRoute("base", "return 1n;", evmOptions()).nest(childA).nest(childB).reward(0n);

    // Both children default to "after": [cook, A-calls..., B-calls...]. Each child's LAST call is
    // its own publishAndFund with a distinct destination — assert those appear in nest() order.
    const publishCalls = built.intent.route.calls
      .map((c) => {
        try {
          return decodeFunctionData({ abi: PORTAL_ABI, data: c.data });
        } catch {
          return undefined;
        }
      })
      .filter((d): d is NonNullable<typeof d> => d?.functionName === "publishAndFund");

    expect(publishCalls).toHaveLength(2);
    const destinations = publishCalls.map((d) => (d.args as readonly [bigint, Hex, unknown, boolean])[0]);
    expect(destinations[0]).toBe(childA.intent.destination);
    expect(destinations[1]).toBe(childB.intent.destination);
  });

  it("position: 'before' puts the child's calls ahead of the compiled cook call", () => {
    const child = childSpec("arbitrum").reward(0n);
    const built = openRoute("base", "function main() { return 1n; }", evmOptions())
      .nest(child, { position: "before" })
      .reward(0n);

    // exactly one non-publishAndFund call (the cook), which must be the LAST call.
    const decoded = built.intent.route.calls.map((c) => {
      try {
        return decodeFunctionData({ abi: PORTAL_ABI, data: c.data }).functionName;
      } catch {
        return "cook";
      }
    });
    expect(decoded[decoded.length - 1]).toBe("cook");
    expect(decoded.slice(0, -1).every((f) => f === "publishAndFund")).toBe(true);
  });

  it("precalls still lead, ahead of any nested children", () => {
    const precalls = [{ target: "0x5555555555555555555555555555555555555555" as Hex, data: "0xaa" as Hex, value: 0n }];
    const child = childSpec("arbitrum").reward(0n);
    const built = openRoute("base", "return 1n;", evmOptions({ precalls })).nest(child).reward(0n);
    expect(built.intent.route.calls[0]!.data).toBe("0xaa");
  });
});

describe(".nest(): no-regression control", () => {
  it("a depth-1 build with no .nest() is byte-identical to the plain (pre-nesting) build", () => {
    const withoutNest = openRoute("base", "return 1n;", evmOptions()).reward(0n);
    expect(withoutNest.children).toEqual([]);
    expect(withoutNest.intents()).toEqual([withoutNest.intent]);
  });

  it("the string-body form nests identically to the closure form", () => {
    const child = childSpec("arbitrum").reward(0n);

    const viaString = openRoute("base", "return 1n;", evmOptions()).nest(child).reward(0n);
    const viaClosure = openRoute("base", () => {
      return 1n;
    }, evmOptions()).nest(child).reward(0n);

    expect(viaString.intent.route.calls).toEqual(viaClosure.intent.route.calls);
    expect(viaString.children).toHaveLength(1);
    expect(viaClosure.children).toHaveLength(1);
  });
});
