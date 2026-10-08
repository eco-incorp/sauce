/**
 * routes/portal.ts — submission/read calldata contract tests.
 *
 * Pure: hand-built `Intent`s, no compiler, no network. Every tx is re-decoded against the SAME
 * registered `PortalABI` and asserted against `encodeRoute`/`decodeRewardEvm` — the agreement
 * portal.ts's module doc claims, checked rather than assumed.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  type Hex,
} from "viem";

import {
  approvalTxs,
  fulfillApprovalTxs,
  fulfillTx,
  fundTx,
  intentHashCall,
  intentVaultAddressCall,
  isIntentFundedCall,
  publishAndFundTx,
  publishTx,
} from "../src/routes/portal.js";
import {
  decodeRewardEvm,
  encodeRoute,
  encodeRouteSvm,
  EVM_REWARD_PARAM,
  EVM_ROUTE_PARAM,
  hashIntent,
} from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import type { Intent, Reward, Route, UniversalAddress } from "../src/routes/types.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";

const evmAddr = (byte: string): UniversalAddress =>
  toUniversalAddress(("0x" + byte.repeat(20)) as Hex);
const svmAddr = (byte: string): UniversalAddress =>
  toUniversalAddress(("0x" + byte.repeat(32)) as Hex);
const salt32 = (byte: string) => ("0x" + byte.repeat(32)) as Hex;

const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const BASE_CHAIN_ID = 8453n;
const SOLANA_CHAIN_ID = 1399811149n;

function baseRoute(overrides: Partial<Route> = {}): Route {
  return {
    salt: salt32("11"),
    deadline: 1893456000n,
    portal: evmAddr("22"),
    nativeAmount: 0n,
    tokens: [],
    calls: [{ target: evmAddr("44"), data: "0xdeadbeef", value: 0n }],
    ...overrides,
  };
}

function baseReward(overrides: Partial<Reward> = {}): Reward {
  return {
    deadline: 1893456000n,
    creator: evmAddr("55"),
    prover: evmAddr("66"),
    nativeAmount: 0n,
    tokens: [
      { token: evmAddr("77"), amount: 9n },
      { token: evmAddr("88"), amount: 5n },
    ],
    ...overrides,
  };
}

function evmIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    destination: BASE_CHAIN_ID,
    sourceChainId: BASE_CHAIN_ID,
    route: baseRoute(),
    reward: baseReward(),
    ...overrides,
  };
}

describe("portal.ts: publishTx", () => {
  it("selector + decoded args round-trip; value is always 0n", () => {
    const intent = evmIntent();
    const tx = publishTx(intent, { portal: PORTAL });

    expect(tx.to.toLowerCase()).toBe(PORTAL.toLowerCase());
    expect(tx.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("publish");
    const [destination, routeBytes, rewardArg] = decoded.args as readonly [bigint, Hex, unknown];
    expect(destination).toBe(intent.destination);
    expect(routeBytes).toBe(encodeRoute(intent.route, intent.destination));
    expect(decodeRewardEvm(encodeRewardTuple(rewardArg))).toEqual(intent.reward);
  });
});

/** Re-encodes a decoded reward tuple back through the same ABI shape so it can be fed to
 *  `decodeRewardEvm`, proving the calldata reward and `intent.reward` are the same bytes. */
function encodeRewardTuple(rewardArg: unknown): Hex {
  return encodeAbiParameters([EVM_REWARD_PARAM], [rewardArg as never]);
}

describe("portal.ts: publishAndFundTx", () => {
  it("value equals reward.nativeAmount; args round-trip", () => {
    const intent = evmIntent({ reward: baseReward({ nativeAmount: 42n }) });
    const tx = publishAndFundTx(intent, true, { portal: PORTAL });

    expect(tx.value).toBe(42n);
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("publishAndFund");
    const [destination, routeBytes, rewardArg, allowPartial] = decoded.args as readonly [
      bigint,
      Hex,
      unknown,
      boolean,
    ];
    expect(destination).toBe(intent.destination);
    expect(routeBytes).toBe(encodeRoute(intent.route, intent.destination));
    expect(decodeRewardEvm(encodeRewardTuple(rewardArg))).toEqual(intent.reward);
    expect(allowPartial).toBe(true);
  });

  it("publishTx.value is 0n even when the reward has a native amount", () => {
    const intent = evmIntent({ reward: baseReward({ nativeAmount: 42n }) });
    expect(publishTx(intent, { portal: PORTAL }).value).toBe(0n);
  });
});

describe("portal.ts: fundTx", () => {
  it("value equals reward.nativeAmount; routeHash arg matches hashIntent", () => {
    const intent = evmIntent({ reward: baseReward({ nativeAmount: 7n }) });
    const tx = fundTx(intent, false, { portal: PORTAL });

    expect(tx.value).toBe(7n);
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("fund");
    const [destination, routeHashArg, rewardArg, allowPartial] = decoded.args as readonly [
      bigint,
      Hex,
      unknown,
      boolean,
    ];
    expect(destination).toBe(intent.destination);
    expect(routeHashArg).toBe(hashIntent(intent).routeHash);
    expect(decodeRewardEvm(encodeRewardTuple(rewardArg))).toEqual(intent.reward);
    expect(allowPartial).toBe(false);
  });
});

describe("portal.ts: approvalTxs", () => {
  it("one per reward token, in order, spender is the Portal (not the vault), exact amount, value 0n", () => {
    const intent = evmIntent({
      reward: baseReward({
        tokens: [
          { token: evmAddr("77"), amount: 9n },
          { token: evmAddr("88"), amount: 5n },
        ],
      }),
    });
    const txs = approvalTxs(intent, { portal: PORTAL });

    expect(txs).toHaveLength(2);
    expect(txs[0]!.to.toLowerCase()).toBe(("0x" + "77".repeat(20)).toLowerCase());
    expect(txs[1]!.to.toLowerCase()).toBe(("0x" + "88".repeat(20)).toLowerCase());
    for (const tx of txs) expect(tx.value).toBe(0n);

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
      data: txs[0]!.data,
    });
    const [spender0, amount0] = decoded0.args as readonly [Hex, bigint];
    expect(spender0.toLowerCase()).toBe(PORTAL.toLowerCase());
    expect(spender0.toLowerCase()).not.toBe(("0x" + "77".repeat(20)).toLowerCase()); // not the vault/token itself
    expect(amount0).toBe(9n);
  });

  it("empty array for a native-only reward", () => {
    const intent = evmIntent({ reward: baseReward({ tokens: [], nativeAmount: 5n }) });
    expect(approvalTxs(intent, { portal: PORTAL })).toEqual([]);
  });

  it("descending duplicates collapse to one approve for the largest amount, not the last", () => {
    const intent = evmIntent({
      reward: baseReward({
        tokens: [
          { token: evmAddr("77"), amount: 20n },
          { token: evmAddr("77"), amount: 10n },
        ],
      }),
    });
    const txs = approvalTxs(intent, { portal: PORTAL });

    expect(txs).toHaveLength(1);
    expect(txs[0]!.to.toLowerCase()).toBe(("0x" + "77".repeat(20)).toLowerCase());
    expect(decodeApprove(txs[0]!.data)).toEqual([PORTAL.toLowerCase(), 20n]);
  });

  it("non-monotonic duplicates collapse to one approve for the maximum, never the sum", () => {
    const intent = evmIntent({
      reward: baseReward({
        tokens: [
          { token: evmAddr("77"), amount: 10n },
          { token: evmAddr("77"), amount: 20n },
          { token: evmAddr("77"), amount: 15n },
        ],
      }),
    });
    const txs = approvalTxs(intent, { portal: PORTAL });

    expect(txs).toHaveLength(1);
    expect(decodeApprove(txs[0]!.data)).toEqual([PORTAL.toLowerCase(), 20n]);
  });

  it("interleaved duplicates keep first-seen token order", () => {
    const intent = evmIntent({
      reward: baseReward({
        tokens: [
          { token: evmAddr("88"), amount: 3n },
          { token: evmAddr("77"), amount: 20n },
          { token: evmAddr("88"), amount: 9n },
          { token: evmAddr("77"), amount: 10n },
        ],
      }),
    });
    const txs = approvalTxs(intent, { portal: PORTAL });

    expect(txs.map((tx) => tx.to.toLowerCase())).toEqual([
      ("0x" + "88".repeat(20)).toLowerCase(),
      ("0x" + "77".repeat(20)).toLowerCase(),
    ]);
    expect(txs.map((tx) => decodeApprove(tx.data)[1])).toEqual([9n, 20n]);
  });

  it("a token whose largest entry is zero is still emitted as approve(portal, 0)", () => {
    const intent = evmIntent({
      reward: baseReward({
        tokens: [
          { token: evmAddr("77"), amount: 0n },
          { token: evmAddr("88"), amount: 5n },
        ],
      }),
    });
    const txs = approvalTxs(intent, { portal: PORTAL });

    expect(txs).toHaveLength(2);
    expect(decodeApprove(txs[0]!.data)).toEqual([PORTAL.toLowerCase(), 0n]);
    expect(decodeApprove(txs[1]!.data)).toEqual([PORTAL.toLowerCase(), 5n]);
  });
});

/** Decodes an ERC20 `approve` calldata into `[lowercased spender, amount]`. */
function decodeApprove(data: Hex): readonly [string, bigint] {
  const decoded = decodeFunctionData({
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
    data,
  });
  const [spender, amount] = decoded.args as readonly [Hex, bigint];

  return [spender.toLowerCase(), amount];
}

describe("portal.ts: intentVaultAddressCall", () => {
  it("decodes a hand-built 32-byte address word", () => {
    const intent = evmIntent();
    const call = intentVaultAddressCall(intent, { portal: PORTAL });
    expect(call.to.toLowerCase()).toBe(PORTAL.toLowerCase());

    const fakeVault = ("0x" + "00".repeat(12) + "99".repeat(20)) as Hex;
    const [decoded] = decodeAbiParameters([{ type: "address" }], fakeVault);
    expect(call.decode(fakeVault)).toBe(decoded);
  });
});

describe("portal.ts: intentHashCall", () => {
  it("decodes the (intentHash, routeHash, rewardHash) shape", () => {
    const intent = evmIntent();
    const call = intentHashCall(intent, { portal: PORTAL });

    const expected = hashIntent(intent);
    const word = (h: Hex) => h;
    const encoded = ("0x" +
      word(expected.intentHash).slice(2) +
      word(expected.routeHash).slice(2) +
      word(expected.rewardHash).slice(2)) as Hex;
    expect(call.decode(encoded)).toEqual(expected);
  });
});

describe("portal.ts: isIntentFundedCall", () => {
  it("decodes a bool", () => {
    const call = isIntentFundedCall(evmIntent(), { portal: PORTAL });
    const trueWord = ("0x" + "00".repeat(31) + "01") as Hex;
    const falseWord = ("0x" + "00".repeat(32)) as Hex;
    expect(call.decode(trueWord)).toBe(true);
    expect(call.decode(falseWord)).toBe(false);
  });
});

describe("portal.ts: cross-VM — SVM destination", () => {
  it("produces valid calldata whose route bytes are the Borsh blob", () => {
    const intent = evmIntent({
      destination: SOLANA_CHAIN_ID,
      route: {
        salt: salt32("11"),
        deadline: 1893456000n,
        portal: svmAddr("22"),
        nativeAmount: 0n,
        tokens: [],
        calls: [{ target: svmAddr("44"), data: "0xdead", value: 0n }],
      },
    });
    const tx = publishAndFundTx(intent, false, { portal: PORTAL });
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    const [, routeBytes] = decoded.args as readonly [bigint, Hex, unknown, boolean];
    expect(routeBytes).toBe(encodeRoute(intent.route, intent.destination));
    // Borsh, not ABI: the route bytes are exactly the Borsh blob encodeRouteSvm produces, not an
    // abi.encode(route) the Intent-tuple overload would have produced instead.
    expect(routeBytes).toBe(encodeRouteSvm(intent.route));
  });
});

describe("portal.ts: fulfillTx", () => {
  const CLAIMANT = "0x9999999999999999999999999999999999999999" as const;
  const intent = evmIntent({
    sourceChainId: 42161n,
    route: baseRoute({
      nativeAmount: 1234n,
      tokens: [{ token: evmAddr("77"), amount: 5n }],
      calls: [{ target: evmAddr("44"), data: "0xdeadbeef", value: 1234n }],
    }),
  });

  it("goes to the route's own Portal with the route's native amount", () => {
    const tx = fulfillTx(intent, { claimant: CLAIMANT });
    expect(tx.to).toBe(PORTAL);
    expect(tx.value).toBe(1234n);
  });

  it("carries the hashes hashIntent computes, and a route the Portal hashes to the same routeHash", () => {
    const tx = fulfillTx(intent, { claimant: CLAIMANT });
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("fulfill");
    const [intentHash, route, rewardHash, claimant] = decoded.args as readonly [
      Hex,
      unknown,
      Hex,
      Hex,
    ];
    const expected = hashIntent(intent);
    expect(intentHash).toBe(expected.intentHash);
    expect(rewardHash).toBe(expected.rewardHash);
    expect(claimant).toBe(toUniversalAddress(CLAIMANT));
    // What `Inbox._fulfill` does with the tuple it is given: `keccak256(abi.encode(route))`, then
    // `keccak256(abi.encodePacked(uint64 chainid, routeHash, rewardHash))`.
    const routeHash = keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route as never]));
    expect(routeHash).toBe(expected.routeHash);
    expect(
      keccak256(
        encodePacked(["uint64", "bytes32", "bytes32"], [intent.destination, routeHash, rewardHash]),
      ),
    ).toBe(intentHash);
  });

  it("takes a 32-byte claimant as it is, and refuses a zero one", () => {
    const wide = `0x${"ab".repeat(32)}` as Hex;
    const decoded = decodeFunctionData({
      abi: PortalABI,
      data: fulfillTx(intent, { claimant: wide }).data,
    });
    expect(decoded.args[3]).toBe(wide);
    expect(() => fulfillTx(intent, { claimant: `0x${"00".repeat(20)}` })).toThrow(/zero/);
  });

  it("refuses a Solana destination", () => {
    const svm = evmIntent({
      destination: SOLANA_CHAIN_ID,
      route: baseRoute({ portal: svmAddr("22"), calls: [] }),
    });
    expect(() => fulfillTx(svm, { claimant: CLAIMANT })).toThrow(/not an EVM chain/);
    expect(() => fulfillApprovalTxs(svm)).toThrow(/not an EVM chain/);
  });
});

describe("portal.ts: fulfillApprovalTxs", () => {
  it("one approve to the route's Portal per distinct route token, the entries SUMMED, first-seen order", () => {
    const intent = evmIntent({
      route: baseRoute({
        tokens: [
          { token: evmAddr("77"), amount: 5n },
          { token: evmAddr("88"), amount: 2n },
          { token: evmAddr("77"), amount: 3n },
        ],
      }),
    });
    const txs = fulfillApprovalTxs(intent);
    expect(txs.map((tx) => tx.to)).toEqual([`0x${"77".repeat(20)}`, `0x${"88".repeat(20)}`]);
    const args = txs.map((tx) => decodeFunctionData({ abi: ERC20ABI, data: tx.data }).args);
    expect(args).toEqual([
      [PORTAL, 8n],
      [PORTAL, 2n],
    ]);
    expect(txs.every((tx) => tx.value === 0n)).toBe(true);
  });

  it("nothing for a route that delivers no tokens", () => {
    expect(fulfillApprovalTxs(evmIntent())).toEqual([]);
  });
});

describe("portal.ts: EVM-source guard", () => {
  const svmSourceIntent = evmIntent({ sourceChainId: SOLANA_CHAIN_ID });

  it.each([
    ["publishTx", () => publishTx(svmSourceIntent, { portal: PORTAL })],
    ["publishAndFundTx", () => publishAndFundTx(svmSourceIntent, false, { portal: PORTAL })],
    ["fundTx", () => fundTx(svmSourceIntent, false, { portal: PORTAL })],
    ["approvalTxs", () => approvalTxs(svmSourceIntent, { portal: PORTAL })],
    ["intentVaultAddressCall", () => intentVaultAddressCall(svmSourceIntent, { portal: PORTAL })],
    ["intentHashCall", () => intentHashCall(svmSourceIntent, { portal: PORTAL })],
    ["isIntentFundedCall", () => isIntentFundedCall(svmSourceIntent, { portal: PORTAL })],
  ])("%s throws for an SVM-sourced intent", (_name, fn) => {
    expect(fn).toThrow(/evm/i);
  });
});

describe("a route body has no Portal binding", () => {
  // The SDK builds the Portal's calls itself (`routes/portal.ts`). A second, hand-written way to
  // reach the Portal from a program is exactly what that design exists to rule out, so it must stay
  // absent.
  it("rejects `IPortal.at(...)` with no `contracts` option", () => {
    const source = [
      "function main() {",
      "  const route = hex`aabb`;",
      "  IPortal.at(0x3333333333333333333333333333333333333333).publishAndFund(",
      "    42161n, route,",
      "    { deadline: 2000n, creator: 0x4444444444444444444444444444444444444444,",
      "      prover: 0x5555555555555555555555555555555555555555, nativeAmount: 0n, tokens: [] },",
      "    false);",
      "}",
    ].join("\n");

    expect(() =>
      compileSauceRoute("base", source, {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(/IPortal/);
  });
});
