import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, getCreate2Address, numberToHex, type Hex } from "viem";
import { requireChain } from "../src/chains/canonical.js";
import { potCommand, txCommand, type CliFiles } from "../src/cli/commands.js";
import { keeping } from "../src/cli/keep.js";
import { POT_SCHEMA, PotStore } from "../src/cli/pot-store.js";
import { v12PotGateSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12ReleaseSet } from "../src/deployments/releases.js";

const chain = requireChain("base");
const owner = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const salt = numberToHex(0, { size: 32 });
const files: CliFiles = { readText: () => "", readModule: () => undefined };

describe("command binding handoff boundaries", () => {
  it("reports a retained owner/salt target without emitting a different CREATE3 deployment call", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sauce-command-binding-"));
    try {
      const release = v12ReleaseSet("2.6.0");
      const kitchen = getAddress(release["kitchen-evm"].kitchen!);
      const pot = getCreate2Address({
        from: kitchen,
        salt: v12PotGateSalt(owner, salt, false),
        bytecodeHash: release["kitchen-evm"].potInitCodeHash as Hex,
      });
      const store = new PotStore(directory);
      store.save({
        schema: POT_SCHEMA,
        chain: chain.slug,
        chainId: chain.id,
        pot,
        owner,
        salt,
        kind: "private",
        kitchen,
        sdk: "LOCAL",
        origin: "imported",
        recordedAt: "2026-10-31T00:00:00.000Z",
      });
      await keeping({ stores: { pots: store }, say: () => undefined }, async () => {
        const result = potCommand({ chain, owner, salt });
        expect(result.json.pot).toBe(pot);
        expect(result.json.pot).not.toBe(v12PredictPot(owner, salt, kitchen));
        expect(result.json.retained).toBe(true);
        expect(result.json.to).toBeUndefined();
        expect(result.json.data).toBeUndefined();
        expect(result.cast).toBeUndefined();
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an offline cook handoff even when an explicit value avoids fee discovery", async () => {
    await expect(
      txCommand(
        {
          file: "inline.sauce",
          text: "function main(): Uint256 { return 42; }",
          chain,
          defines: {},
          target: { owner, salt },
          value: 0n,
        },
        files,
      ),
    ).rejects.toThrow(/requires an RPC endpoint and an authenticated deployed Pot/);
  });
});
