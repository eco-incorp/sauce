/**
 * `protocols/eco-routes/abis.ts` and `routes/portal.ts` both declare the Portal, for different
 * reasons — one describes the contract a consumer might call, the other is the working subset the
 * SDK's own calldata helpers encode against. Two declarations of one contract drift, and the way it
 * shows up is a selector that no longer matches the deployed function: calldata that encodes
 * cleanly, sends cleanly, and reverts.
 *
 * Every function both declare is compared by selector here. The registered ABI is free to grow;
 * it is not free to disagree.
 */
import { getAbiItem, toFunctionSelector, type Abi, type AbiFunction } from "viem";

import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { PORTAL_ABI } from "../src/routes/portal.js";
import { ecoRoutesGenerations } from "../src/protocols/eco-routes/lookup.js";

const shared = (PORTAL_ABI as unknown as Abi)
  .filter((item): item is AbiFunction => item.type === "function")
  .map((item) => item.name);

describe("the registered Portal ABI agrees with the one the SDK encodes against", () => {
  it("covers every function the calldata helpers use", () => {
    for (const name of shared) {
      expect(getAbiItem({ abi: PortalABI as unknown as Abi, name })).toBeDefined();
    }
    expect(shared.length).toBeGreaterThan(0);
  });

  it.each(shared)("%s has the same selector in both", (name) => {
    const registered = getAbiItem({ abi: PortalABI as unknown as Abi, name }) as AbiFunction;
    const encoded = getAbiItem({ abi: PORTAL_ABI as unknown as Abi, name }) as AbiFunction;

    expect(toFunctionSelector(registered)).toBe(toFunctionSelector(encoded));
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
