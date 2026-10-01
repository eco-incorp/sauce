/**
 * `protocols/eco-routes/abis.ts` is the SDK's only declaration of the Portal, and `routes/portal.ts`
 * encodes its submission calldata against it. What can still drift is the reward: the calldata
 * encodes it with this ABI's tuple, while `hashIntent` hashes it with `encode.ts`'s
 * `EVM_REWARD_PARAM`. Two tuples that disagree give calldata that encodes cleanly, sends cleanly,
 * and publishes an intent under a hash nobody computed.
 *
 * Its events and errors are pinned against the deployed Portal by `registry-abi.test.ts`; what is
 * here is the one consumer the SDK has of them, the `sauce` CLI's revert reasons.
 */
import {
  encodeAbiParameters,
  encodeErrorResult,
  getAbiItem,
  keccak256,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
} from "viem";

import { revertReason } from "../src/cli/chain.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesGenerations } from "../src/protocols/eco-routes/lookup.js";
import { EVM_REWARD_PARAM } from "../src/routes/encode.js";

/** Every Portal function `routes/portal.ts` encodes. */
const ENCODED = [
  "publish",
  "publishAndFund",
  "fund",
  "intentVaultAddress",
  "getIntentHash",
  "isIntentFunded",
] as const;

const functionsNamed = (name: string): AbiFunction[] =>
  (PortalABI as unknown as Abi).filter(
    (item): item is AbiFunction => item.type === "function" && item.name === name,
  );

describe("the registered Portal ABI is the one the SDK encodes against", () => {
  it.each(ENCODED)("declares exactly one %s", (name) => {
    // One overload per name is what lets `encodeFunctionData({ functionName })` never pick the wrong
    // signature.
    expect(functionsNamed(name)).toHaveLength(1);
  });

  it.each(ENCODED)("%s encodes its reward exactly as the intent hash does", (name) => {
    const reward = functionsNamed(name)[0]!.inputs.find((input) => input.name === "reward");
    const sample = {
      deadline: 2_000_000_000n,
      creator: "0x4444444444444444444444444444444444444444",
      prover: "0x5555555555555555555555555555555555555555",
      nativeAmount: 7n,
      tokens: [
        { token: "0x6666666666666666666666666666666666666666", amount: 1n },
        { token: "0x7777777777777777777777777777777777777777", amount: 2n },
      ],
    } as const;

    expect(reward).toBeDefined();
    expect(encodeAbiParameters([reward!], [sample])).toBe(
      encodeAbiParameters([EVM_REWARD_PARAM], [sample]),
    );
  });

  it("takes the route as `bytes`, never as a tuple", () => {
    // Load-bearing: a Solana destination's route is Borsh, so the Portal has to receive the exact
    // blob the SDK hashed rather than re-encoding a struct itself.
    for (const name of ["publish", "publishAndFund", "getIntentHash", "intentVaultAddress"]) {
      const item = getAbiItem({ abi: PortalABI as unknown as Abi, name }) as AbiFunction;
      expect(item.inputs.map((input) => input.type)).toContain("bytes");
    }
  });
});

describe("a Portal revert reads by name", () => {
  // `publishAndFund(..., allowPartial = false)` with the reward not fully funded: what an agent's
  // `sauce intent publish --dry-run` met as bare revert data while the ABI declared no errors.
  const intentHash = keccak256("0x01");
  const data = encodeErrorResult({
    abi: PortalABI,
    errorName: "InsufficientFunds",
    args: [intentHash],
  });

  it("InsufficientFunds is the selector the deployed Portal reverts with", () => {
    expect(data.slice(0, 10)).toBe(toFunctionSelector("InsufficientFunds(bytes32)"));
    expect(data.slice(0, 10)).toBe("0x07b90620");
  });

  it("the CLI names it, with its argument", () => {
    // viem's error chain carries the node's revert data as `data`; `revertReason` walks to it.
    expect(revertReason({ message: "execution reverted", data })).toBe(
      `InsufficientFunds(${intentHash})`,
    );
  });
});

describe("the address tables are pinned", () => {
  it("records a version and a digest for every generation", () => {
    const generations = ecoRoutesGenerations();

    expect(generations.length).toBeGreaterThanOrEqual(2);
    for (const generation of generations) {
      expect(generation.version).toMatch(/^\d+\.\d+\.\d+$/);
      // A version alone is not a pin -- npm allows a republish, and a wrong Portal address is funds
      // sent somewhere nobody chose.
      expect(generation.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(generation.roles.length).toBeGreaterThan(0);
    }
  });

  it("the current generation deploys a Portal and the previous one does not", () => {
    const [v3, v2] = ecoRoutesGenerations();

    expect(v3!.generation).toBe("v3");
    expect(v3!.roles).toContain("Portal");
    expect(v2!.roles).toContain("IntentSource");
    expect(v2!.roles).not.toContain("Portal");
  });
});
