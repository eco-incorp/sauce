/**
 * routes/portal.ts after the fill: the proof, the claim, the refund and the cancellation, and the
 * reads that decide them. Pure: hand-built intents, every request decoded again against the
 * registry's own ABIs and checked against the values eco-routes computes them from.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";

import { PortalABI, ProverABI } from "../src/protocols/eco-routes/abis.js";
import { encodeRoute, evmRouteTuple, hashIntent } from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import {
  batchWithdrawTx,
  CANCELLED_CLAIMANT,
  CANCELLED_CLAIMANT_BYTES32,
  cancelAndProveTx,
  cancelTx,
  fulfillAndProveTx,
  fulfillmentCall,
  hyperlaneProverData,
  intentFromPublished,
  proofMessage,
  provenIntentCall,
  proverFeeCall,
  proveTx,
  refundTx,
  REWARD_STATUSES,
  rewardStatusCall,
  withdrawTx,
} from "../src/routes/portal.js";
import type { Intent, UniversalAddress } from "../src/routes/types.js";

const u = (byte: string): UniversalAddress => toUniversalAddress(`0x${byte.repeat(20)}` as Hex);
const SOURCE_PORTAL = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x5555555555555555555555555555555555555555" as const;

const intent = (salt = "11"): Intent => ({
  sourceChainId: 42161n,
  destination: 8453n,
  route: {
    salt: `0x${salt.repeat(32)}`,
    deadline: 1_893_456_000n,
    portal: u("22"),
    nativeAmount: 1_234n,
    tokens: [{ token: u("44"), amount: 1_000_000n }],
    calls: [{ target: u("44"), data: "0xa9059cbb", value: 0n }],
  },
  reward: {
    deadline: 1_893_542_400n,
    creator: u("66"),
    prover: u("77"),
    nativeAmount: 0n,
    tokens: [{ token: u("88"), amount: 1_050_000n }],
  },
});

const proof = { prover: PROVER, sourceDomain: 42161n, data: "0xabcd" as Hex, fee: 7_777n };

const rewardTuple = (value: Intent) => ({
  deadline: value.reward.deadline,
  creator: getAddress(`0x${"66".repeat(20)}`),
  prover: getAddress(`0x${"77".repeat(20)}`),
  nativeAmount: value.reward.nativeAmount,
  tokens: [{ token: getAddress(`0x${"88".repeat(20)}`), amount: 1_050_000n }],
});

describe("the destination after the fill", () => {
  it("fulfillAndProve: the fill and its proof, the fee added to the route's native amount", () => {
    const value = intent();
    const { intentHash, rewardHash } = hashIntent(value);
    const claimant = `0x${"99".repeat(20)}` as Hex;
    const tx = fulfillAndProveTx(value, { claimant, ...proof });
    expect(tx.to).toBe(`0x${"22".repeat(20)}`);
    expect(tx.value).toBe(1_234n + 7_777n);
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("fulfillAndProve");
    expect(decoded.args).toEqual([
      intentHash,
      { ...evmRouteTuple(value.route), portal: getAddress(evmRouteTuple(value.route).portal) },
      rewardHash,
      toUniversalAddress(claimant),
      PROVER,
      42161n,
      "0xabcd",
    ]);
    expect(() => fulfillAndProveTx(value, { claimant: `0x${"00".repeat(32)}`, ...proof })).toThrow(
      /claimant is zero/,
    );
  });

  it("prove: one proof for intents through one Portal, the fee its value", () => {
    const one = intent("11");
    const two = intent("12");
    const tx = proveTx([one, two], proof);
    expect(tx.value).toBe(7_777n);
    const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
    expect(decoded.functionName).toBe("prove");
    expect(decoded.args).toEqual([
      PROVER,
      42161n,
      [hashIntent(one).intentHash, hashIntent(two).intentHash],
      "0xabcd",
    ]);
    const elsewhere = { ...two, route: { ...two.route, portal: u("23") } };
    expect(() => proveTx([one, elsewhere], proof)).toThrow(/different Portals/);
    expect(() => proveTx([], proof)).toThrow(/no intent to prove/);
  });

  it("cancel and cancelAndProve: the intent's hashes and route, nothing paid but the fee", () => {
    const value = intent();
    const { intentHash, rewardHash } = hashIntent(value);
    const cancel = cancelTx(value);
    expect(cancel.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: PortalABI, data: cancel.data });
    expect(decoded.functionName).toBe("cancel");
    expect(decoded.args[0]).toBe(intentHash);
    expect(decoded.args[2]).toBe(rewardHash);
    const both = cancelAndProveTx(value, proof);
    expect(both.value).toBe(7_777n);
    expect(decodeFunctionData({ abi: PortalABI, data: both.data }).args.slice(3)).toEqual([
      PROVER,
      42161n,
      "0xabcd",
    ]);
  });

  it("the cancellation's sentinel is eco-routes' address, the same 32 bytes on both VMs", () => {
    // `address(uint160(uint256(keccak256("eco.portal.intent.cancelled"))))` (design doc D2).
    expect(CANCELLED_CLAIMANT).toBe("0xe685056aEc77686A83E2a6bDf37c6f71dD2fdB5f");
    expect(CANCELLED_CLAIMANT_BYTES32).toBe(
      "0x000000000000000000000000e685056aec77686a83e2a6bdf37c6f71dd2fdb5f",
    );
    expect(keccak256(toHex("eco.portal.intent.cancelled")).slice(-40)).toBe(
      CANCELLED_CLAIMANT.slice(2).toLowerCase(),
    );
  });

  it("reads what the destination recorded, and the message its prover is handed", () => {
    const value = intent();
    const call = fulfillmentCall(value);
    expect(decodeFunctionData({ abi: PortalABI, data: call.data }).args).toEqual([
      hashIntent(value).intentHash,
    ]);
    expect(
      call.decode(
        encodeFunctionResult({
          abi: PortalABI,
          functionName: "claimants",
          result: CANCELLED_CLAIMANT_BYTES32,
        }),
      ),
    ).toBe(CANCELLED_CLAIMANT_BYTES32);
    // `uint64 chain id ‖ (intentHash ‖ claimant)…`, as `Inbox._prove` builds it.
    const message = proofMessage(8453n, [
      { intentHash: hashIntent(value).intentHash, claimant: `0x${"99".repeat(20)}` },
    ]);
    expect(message).toBe(
      `0x${(8453).toString(16).padStart(16, "0")}${hashIntent(value).intentHash.slice(2)}${"00".repeat(12)}${"99".repeat(20)}`,
    );
    const fee = proverFeeCall({
      prover: PROVER,
      sourceDomain: 42161n,
      destinationChainId: 8453n,
      pairs: [{ intentHash: hashIntent(value).intentHash, claimant: `0x${"99".repeat(20)}` }],
      data: "0x",
    });
    expect(fee.to).toBe(PROVER.toLowerCase());
    expect(decodeFunctionData({ abi: ProverABI, data: fee.data }).args).toEqual([
      42161n,
      message,
      "0x",
    ]);
    expect(
      fee.decode(encodeFunctionResult({ abi: ProverABI, functionName: "fetchFee", result: 5n })),
    ).toBe(5n);
  });

  it("hyperlaneProverData is the HyperProver's (sourceChainProver, metadata, hook) tuple", () => {
    const data = hyperlaneProverData({ sourceProver: PROVER });
    const [unpacked] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [{ type: "bytes32" }, { type: "bytes" }, { type: "address" }],
        },
      ],
      data,
    );
    expect(unpacked).toEqual([toUniversalAddress(PROVER), "0x", zeroAddress]);
  });
});

describe("the source after the fill", () => {
  it("withdraw, batchWithdraw and refund take (destination, routeHash, reward), paying nothing", () => {
    const value = intent();
    const { routeHash } = hashIntent(value);
    for (const [tx, name] of [
      [withdrawTx(value, { portal: SOURCE_PORTAL }), "withdraw"],
      [refundTx(value, { portal: SOURCE_PORTAL }), "refund"],
    ] as const) {
      expect(tx.to).toBe(SOURCE_PORTAL);
      expect(tx.value).toBe(0n);
      const decoded = decodeFunctionData({ abi: PortalABI, data: tx.data });
      expect(decoded.functionName).toBe(name);
      expect(decoded.args).toEqual([8453n, routeHash, rewardTuple(value)]);
    }
    const two = intent("12");
    const batch = decodeFunctionData({
      abi: PortalABI,
      data: batchWithdrawTx([value, two], { portal: SOURCE_PORTAL }).data,
    });
    expect(batch.functionName).toBe("batchWithdraw");
    expect(batch.args).toEqual([
      [8453n, 8453n],
      [routeHash, hashIntent(two).routeHash],
      [rewardTuple(value), rewardTuple(two)],
    ]);
  });

  it("reads the reward's status and the prover's record, by the intent's hash", () => {
    const value = intent();
    const status = rewardStatusCall(value, { portal: SOURCE_PORTAL });
    REWARD_STATUSES.forEach((name, index) =>
      expect(
        status.decode(
          encodeFunctionResult({ abi: PortalABI, functionName: "getRewardStatus", result: index }),
        ),
      ).toBe(name),
    );
    const proven = provenIntentCall(value);
    expect(proven.to).toBe(`0x${"77".repeat(20)}`);
    expect(decodeFunctionData({ abi: ProverABI, data: proven.data }).args).toEqual([
      hashIntent(value).intentHash,
    ]);
    expect(
      proven.decode(
        encodeFunctionResult({
          abi: ProverABI,
          functionName: "provenIntents",
          result: { claimant: CANCELLED_CLAIMANT, destination: 8453n },
        }),
      ),
    ).toEqual({ claimant: CANCELLED_CLAIMANT, destination: 8453n });
  });
});

describe("intentFromPublished", () => {
  const event = getAbiItem({ abi: PortalABI, name: "IntentPublished" });
  const logOf = (value: Intent, hash = hashIntent(value).intentHash) => ({
    topics: encodeEventTopics({
      abi: PortalABI,
      eventName: "IntentPublished",
      args: {
        intentHash: hash,
        creator: getAddress(`0x${"66".repeat(20)}`),
        prover: getAddress(`0x${"77".repeat(20)}`),
      },
    }) as Hex[],
    data: encodeAbiParameters(
      event.inputs.filter((input) => !input.indexed),
      [
        value.destination,
        encodeRoute(value.route, Number(value.destination)),
        value.reward.deadline,
        value.reward.nativeAmount,
        rewardTuple(value).tokens,
      ],
    ),
  });

  it("rebuilds the intent the log announces, the chain read on its source", () => {
    const value = intent();
    expect(intentFromPublished(logOf(value), 42161n)).toEqual({
      intent: value,
      intentHash: hashIntent(value).intentHash,
    });
  });

  it("skips every other log, the Portal's own included, and refuses one it would misread", () => {
    const funded = encodeEventTopics({ abi: PortalABI, eventName: "IntentFunded" }) as Hex[];
    expect(
      intentFromPublished(
        {
          topics: funded,
          data: encodeAbiParameters(
            [{ type: "bytes32" }, { type: "address" }, { type: "bool" }],
            [hashIntent(intent()).intentHash, zeroAddress, true],
          ),
        },
        42161n,
      ),
    ).toBeUndefined();
    // A log whose fields do not hash to the intent hash it names is refused, not misread.
    expect(() =>
      intentFromPublished(logOf(intent(), hashIntent(intent("12")).intentHash), 42161n),
    ).toThrow(/hashes to 0x[0-9a-f]{64}, not the/);
  });
});
