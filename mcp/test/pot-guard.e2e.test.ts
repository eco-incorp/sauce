/**
 * The tools refuse a cook whose Pot the deployed Kitchen does not put where the SDK predicts it, as
 * the `sauce` command does (`sdk/test/cli-pot-guard.e2e.test.ts`), naming the release the Kitchen
 * mints. A server that keeps the `sauce` command's Pot store (`McpStores.pots`, over stdio) lists
 * the owner's other Pots from it, each with its release; one that keeps none (over HTTP) refuses
 * without the list.
 *
 * On a local anvil with the released gated stack (`sdk/test/cli-anvil.ts`), the Kitchen proxy
 * pointed at `MispredictingKitchen` (`sdk/test/evm/kitchen-releases.ts`) for a while; pointed back
 * at the release, the same calls succeed.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { getAddress, type Address } from "viem";

import { PotStore } from "../../sdk/dist/cli/pot-store.js";
import { potSalt, v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { RUNTIME_HEX_PATH, startChain, type LocalChain } from "../../sdk/test/cli-anvil.js";
import {
  ELSEWHERE,
  mintOldReleasePot,
  OLD_RELEASE,
  plantMispredictingKitchen,
  UNKNOWN_POT_HASH,
  withKitchenImplementation,
} from "../../sdk/test/evm/kitchen-releases.js";
import { createRpcGuard } from "../src/guard.js";
import { connect, endpointsFor, failed, ok, type Connected } from "./harness.js";

/** An owner with no Pot of this release. */
const NOBODY: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";
/** kitchen-evm 1.2.0's release, as a refusal names it. */
const OLD =
  `compiler ${OLD_RELEASE.compiler} (v12-evm ${OLD_RELEASE["v12-evm"].version}, ` +
  `kitchen-evm ${OLD_RELEASE["kitchen-evm"].version})`;

describe(
  "the tools check the Pot against the deployed Kitchen",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let local: LocalChain;
    let dir: string;
    /** As over HTTP: no store. */
    let http: Connected;
    /** As over stdio: the `sauce` command's Pot store. */
    let stdio: Connected;
    let store: PotStore;
    let newer: Address;
    let old: Address;
    const pot = getAddress(v12PredictPot(NOBODY, `0x${"00".repeat(32)}`) as Address);
    const cook = { source: PROGRAM, chain: "ethereum", owner: NOBODY, args: ["41"] };

    before(async () => {
      local = await startChain("ethereum");
      dir = mkdtempSync(join(tmpdir(), "sauce-mcp-pot-guard-"));
      store = new PotStore(join(dir, "pots"));
      newer = await plantMispredictingKitchen(local, UNKNOWN_POT_HASH);
      old = await mintOldReleasePot(local, NOBODY, potSalt("another release"));
      const endpoints = endpointsFor({ [String(local.chain.id)]: local.rpcUrl });
      http = await connect(endpoints, createRpcGuard({ allowPrivate: true }));
      stdio = await connect(endpoints, undefined, undefined, true, { pots: store });
    });

    after(async () => {
      await http?.close();
      await stdio?.close();
      await local?.stop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    });

    it("over HTTP, refuses sauce_tx and sauce_simulate while the Kitchen is newer, listing nothing", async () => {
      await withKitchenImplementation(local, newer, async () => {
        for (const tool of ["sauce_tx", "sauce_simulate"]) {
          const said = failed(await http.call(tool, cook));
          assert.match(said, /this SDK does not match the deployed Kitchen/, tool);
          assert.match(said, /the Kitchen is newer than this SDK/, tool);
          assert.match(said, /Upgrade @eco-incorp\/sauce \(sauce update\)/, tool);
          assert.ok(said.includes(pot) && said.includes(ELSEWHERE), `${tool}: ${said}`);
          assert.doesNotMatch(said, /The Pot store/, tool);
        }
      });
      assert.equal(await local.publicClient.getCode({ address: pot }), undefined);
    });

    it("over stdio, lists the owner's other Pots from the store, each with the release the chain says", async () => {
      // Recorded by sauce_pot_import, its release told from the chain.
      const imported = ok(await stdio.call("sauce_pot_import", { chain: "ethereum", pot: old }));
      assert.deepEqual(
        (imported.pots as Array<{ pot: string; release?: Record<string, string> }>).map(
          (record) => [record.pot, record.release],
        ),
        [
          [
            old,
            {
              compiler: OLD_RELEASE.compiler,
              "v12-evm": OLD_RELEASE["v12-evm"].version,
              "kitchen-evm": OLD_RELEASE["kitchen-evm"].version,
            },
          ],
        ],
      );
      await withKitchenImplementation(local, newer, async () => {
        for (const tool of ["sauce_tx", "sauce_simulate", "sauce_pot"]) {
          const said = failed(
            await stdio.call(
              tool,
              tool === "sauce_pot" ? { chain: "ethereum", owner: NOBODY } : cook,
            ),
          );
          assert.match(said, /the Kitchen is newer than this SDK/, tool);
          assert.ok(
            said.includes(`The Pot store ${store.dir} holds 1 other Pot of ${NOBODY} on ethereum:`),
            `${tool}: ${said}`,
          );
          const line = said.split("\n").find((one) => one.startsWith(`  ${old} `));
          assert.ok(
            line?.includes(`: ${OLD}, @eco-incorp/sauce 0.99.9 to 0.99.15`),
            `${tool}: ${said}`,
          );
        }
      });
      // A Pot of another release, named by its address: refused for its release, read from the chain.
      const said = failed(await stdio.call("sauce_tx", { ...cook, owner: undefined, pot: old }));
      assert.ok(said.includes(`${old} on ethereum is a Pot of ${OLD}`), said);
    });

    it("builds and rehearses as ever on the released Kitchen", async () => {
      for (const mcp of [http, stdio]) {
        const tx = ok(await mcp.call("sauce_tx", cook));
        assert.equal(tx.pot, pot);
        const simulated = ok(await mcp.call("sauce_simulate", cook));
        assert.equal(simulated.ok, true);
      }
    });
  },
);
