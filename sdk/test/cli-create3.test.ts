import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAddress, pad, zeroAddress, type PublicClient } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { requirePot, requireReleasePot } from "../src/cli/chain.js";
import { keeping } from "../src/cli/keep.js";
import { PotStore, POT_SCHEMA } from "../src/cli/pot-store.js";
import { authenticatePot, ownReleasePot } from "../src/cli/pots.js";
import { v12PredictPot, v12PredictSharedPot } from "../src/deployments/pot.js";
import { resolvePotTarget } from "../src/cli/pot-binding.js";
import { v12KitchenAddress } from "../src/deployments/index.js";

const chain = requireChain("base");
const owner = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const salt = pad("0x01", { size: 32 });
const kitchen = getAddress(v12KitchenAddress());

// These tests exercise refusal paths only. Fabricated RPC code is not runtime-authentication proof.
describe("CLI CREATE3 trust boundaries", () => {
  it("uses CREATE3 for all new candidate kinds", () => {
    expect(ownReleasePot(owner, salt, "private")).toBe(v12PredictPot(owner, salt, kitchen));
    expect(ownReleasePot(owner, salt, "private-fixed-router")).toBe(
      v12PredictPot(owner, salt, kitchen, true),
    );
    expect(ownReleasePot(zeroAddress, salt, "shared")).toBe(v12PredictSharedPot(salt, kitchen));
  });

  it("does not authenticate forged getters at a correctly predicted address", async () => {
    const pot = v12PredictPot(owner, salt, kitchen);
    const client = {
      getChainId: async () => chain.id,
      getCode: async () => "0x60006000f3",
      readContract: async ({ functionName }: { functionName: string }) =>
        ({ owner, userSalt: salt, kitchen })[functionName],
    } as unknown as PublicClient;
    expect(await authenticatePot(client, owner, pot)).not.toBe("own");
    await expect(requireReleasePot(client, chain, pot)).rejects.toThrow();
  });

  it("refuses a missing persisted Pot without accepting a new factory prediction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-create3-"));
    try {
      const store = new PotStore(dir);
      const pot = v12PredictPot(owner, salt, kitchen);
      store.save({
        schema: POT_SCHEMA,
        chain: chain.slug,
        chainId: chain.id,
        pot,
        owner,
        salt,
        kind: "private",
        kitchen,
        sdk: "0.0.0",
        origin: "imported",
        recordedAt: "2026-10-31T00:00:00.000Z",
      });
      const client = {
        getChainId: async () => chain.id,
        getCode: async () => "0x",
        readContract: async () => pot,
      } as unknown as PublicClient;
      await keeping({ stores: { pots: store }, say: () => undefined }, async () => {
        await expect(
          requirePot(client, chain, { pot, owner, salt, deployed: false }),
        ).rejects.toThrow(/persisted|expected|recorded/);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps an old persisted owner/salt address instead of switching to a new CREATE3 default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-existing-pot-"));
    try {
      const store = new PotStore(dir);
      const pot = getAddress("0x3333333333333333333333333333333333333333");
      store.save({
        schema: POT_SCHEMA,
        chain: chain.slug,
        chainId: chain.id,
        pot,
        owner,
        salt,
        kind: "private",
        kitchen,
        sdk: "0.0.0",
        origin: "imported",
        recordedAt: "2026-10-31T00:00:00.000Z",
      });
      await keeping({ stores: { pots: store }, say: () => undefined }, async () => {
        expect(resolvePotTarget(chain.id, { owner, salt })).toBe(pot);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
