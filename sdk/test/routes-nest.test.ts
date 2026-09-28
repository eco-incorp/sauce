/**
 * routes/nest.ts — static-child publish-call splice + cascade invariants.
 *
 * Pure: hand-built `Intent`s, no compiler, no network.
 */
import { decodeFunctionData, keccak256, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { hashIntent } from "../src/routes/encode.js";
import { assertNestingInvariants, nestedChildCalls } from "../src/routes/nest.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import type { Intent, Route, UniversalAddress } from "../src/routes/types.js";

const evmAddr = (byte: string): UniversalAddress =>
  toUniversalAddress(("0x" + byte.repeat(20)) as Hex);
const svmAddr = (byte: string): UniversalAddress =>
  toUniversalAddress(("0x" + byte.repeat(32)) as Hex);

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const SOLANA = requireChain("solana");

const PARENT_PORTAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const CHILD_ROUTE_PORTAL = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;

function parentRoute(overrides: Partial<Route> = {}): Route {
  return normalizeRoute({
    deadline: 1000n,
    portal: PARENT_PORTAL,
    nativeAmount: 0n,
    tokens: [],
    calls: [],
    ...overrides,
  });
}

function childIntent(overrides: Partial<Intent> = {}, saltByte = "01"): Intent {
  return {
    destination: BigInt(ARBITRUM.id),
    sourceChainId: BigInt(BASE.id), // parent's destination chain
    route: normalizeRoute({
      salt: ("0x" + saltByte.repeat(32)) as Hex,
      deadline: 1000n,
      portal: CHILD_ROUTE_PORTAL,
      calls: [],
    }),
    reward: normalizeReward({
      deadline: 1000n,
      creator: CREATOR,
      prover: PROVER,
      nativeAmount: 0n,
      tokens: [],
    }),
    ...overrides,
  };
}

describe("nest.ts: nestedChildCalls", () => {
  it("call order/count for a 2-token child: [approve, approve, publishAndFund]", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 5n,
        tokens: [
          { token: evmAddr("77"), amount: 9n },
          { token: evmAddr("88"), amount: 6n },
        ],
      }),
    });
    const calls = nestedChildCalls(child, { portal: PARENT_PORTAL, allowPartial: true });

    expect(calls).toHaveLength(3);
    const decoded0 = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      data: calls[0]!.data,
    });
    const [spender0] = decoded0.args as readonly [Hex, bigint];

    // the approve spender is the PARENT's route.portal ...
    expect(spender0.toLowerCase()).toBe(PARENT_PORTAL.toLowerCase());
    // ... and NOT the child's own route.portal, nor the child's vault (no vault appears anywhere here).
    expect(spender0.toLowerCase()).not.toBe(CHILD_ROUTE_PORTAL.toLowerCase());

    const decodedLast = decodeFunctionData({ abi: PortalABI, data: calls[2]!.data });
    expect(decodedLast.functionName).toBe("publishAndFund");
    expect(calls[2]!.value).toBe(5n);
  });

  it("publishAndFund value equals the child's reward nativeAmount", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 42n,
        tokens: [],
      }),
    });
    const calls = nestedChildCalls(child, { portal: PARENT_PORTAL, allowPartial: false });
    expect(calls).toHaveLength(1); // no reward tokens -> no approves
    expect(calls[0]!.value).toBe(42n);
  });

  it("decoding the appended publishAndFund reproduces the child's own routeHash/hash()", () => {
    const child = childIntent();
    const calls = nestedChildCalls(child, { portal: PARENT_PORTAL, allowPartial: true });
    const publishCall = calls[calls.length - 1]!;

    const decoded = decodeFunctionData({ abi: PortalABI, data: publishCall.data });
    expect(decoded.functionName).toBe("publishAndFund");
    const [destination, routeBytes] = decoded.args as readonly [bigint, Hex, unknown, boolean];
    expect(destination).toBe(child.destination);

    const expected = hashIntent(child);
    // routeBytes is exactly what routeHash was computed from for the child.
    expect(keccak256(routeBytes)).toBe(expected.routeHash);
  });

  it("an svm-destination child is accepted, with Borsh route bytes", () => {
    const child = childIntent({
      destination: BigInt(SOLANA.id),
      route: normalizeRoute({
        salt: ("0x" + "02".repeat(32)) as Hex,
        deadline: 1000n,
        portal: svmAddr("22"),
        calls: [],
      }),
    });
    const calls = nestedChildCalls(child, { portal: PARENT_PORTAL, allowPartial: true });
    expect(calls).toHaveLength(1);
    const decoded = decodeFunctionData({ abi: PortalABI, data: calls[0]!.data });
    expect(decoded.functionName).toBe("publishAndFund");
  });
});

describe("nest.ts: assertNestingInvariants", () => {
  it("passes for a well-formed single child", () => {
    const child = childIntent();
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute(),
        children: [{ intent: child }],
      }),
    ).not.toThrow();
  });

  it("invariant 1: rejects an svm parent", () => {
    const child = childIntent({ sourceChainId: BigInt(SOLANA.id) });
    expect(() =>
      assertNestingInvariants({
        parentChain: SOLANA,
        parentRoute: parentRoute(),
        children: [{ intent: child }],
      }),
    ).toThrow(/evm/i);
  });

  it("invariant 2: rejects a child whose source isn't the parent's destination", () => {
    const child = childIntent({ sourceChainId: BigInt(ARBITRUM.id) }); // should be BASE
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute(),
        children: [{ intent: child }],
      }),
    ).toThrow(/source/i);
  });

  it("invariant 4: rejects a child route.deadline earlier than the parent's route.deadline", () => {
    const child = childIntent({
      route: normalizeRoute({
        salt: ("0x" + "03".repeat(32)) as Hex,
        deadline: 500n,
        portal: CHILD_ROUTE_PORTAL,
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ deadline: 1000n }),
        children: [{ intent: child }],
      }),
    ).toThrow(/deadline/i);
  });

  it("invariant 4: rejects a child reward.deadline earlier than the parent's route.deadline", () => {
    const child = childIntent({
      reward: normalizeReward({ deadline: 500n, creator: CREATOR, prover: PROVER, tokens: [] }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ deadline: 1000n }),
        children: [{ intent: child }],
      }),
    ).toThrow(/deadline/i);
  });

  it("invariant 5: rejects insufficient native funding coverage", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 10n,
        tokens: [],
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ nativeAmount: 5n }),
        children: [{ intent: child }],
      }),
    ).toThrow(/nativeAmount/);
  });

  it("invariant 5: rejects insufficient token funding coverage", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: evmAddr("77"), amount: 100n }],
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ tokens: [{ token: evmAddr("77"), amount: 10n }] }),
        children: [{ intent: child }],
      }),
    ).toThrow(/token/i);
  });

  it("invariant 5: fundedByBody:true opts a child out of the funding-coverage check", () => {
    const child = childIntent({
      reward: normalizeReward({
        deadline: 1000n,
        creator: CREATOR,
        prover: PROVER,
        nativeAmount: 999n,
        tokens: [],
      }),
    });
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute({ nativeAmount: 0n }),
        children: [{ intent: child, fundedByBody: true }],
      }),
    ).not.toThrow();
  });

  it("invariant 6: rejects a duplicate intentHash within one cascade", () => {
    const a = childIntent();
    const b = childIntent(); // identical fields, identical (zero) default salt shape when unspecified
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute(),
        children: [{ intent: a }, { intent: b }],
      }),
    ).toThrow(/intentHash|duplicate/i);
  });

  it("does not throw for two children with distinct salts", () => {
    const a = childIntent({}, "01");
    const b = childIntent({}, "02");
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: parentRoute(),
        children: [{ intent: a }, { intent: b }],
      }),
    ).not.toThrow();
  });
});
