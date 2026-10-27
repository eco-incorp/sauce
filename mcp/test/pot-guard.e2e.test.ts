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

import { encodeFunctionData, getAddress, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { PotStore } from "../../sdk/dist/cli/pot-store.js";
import { v12EngineAddress } from "../../sdk/dist/deployments/index.js";
import { potSalt, v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { v12PotAbi } from "../../sdk/dist/evm/engine.js";
import {
  laggingEndpoint,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import {
  ELSEWHERE,
  mintOldReleasePot,
  OLD_RELEASE,
  plantMispredictingKitchen,
  UNKNOWN_POT_HASH,
  withKitchenImplementation,
} from "../../sdk/test/evm/kitchen-releases.js";
import { createRpcGuard } from "../src/guard.js";
import { connect, endpointsFor, failed, ok, walletsAt, type Connected } from "./harness.js";

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

    /** A server with a wallet of its own, `name`, funded, reaching the chain through `url`. */
    async function walletServer(name: string, url: string) {
      const server = await connect(
        endpointsFor({ [String(local.chain.id)]: url }),
        undefined,
        walletsAt(join(dir, `wallets-${name}`), { start: `throwaway-${process.pid}-${name}` }),
        false,
        { pots: store },
      );
      const wallet = getAddress(
        String(ok(await server.call("sauce_wallet_create", { name })).address),
      );
      await local.send(local.deployer, wallet, "0x", parseEther("1"));

      return { server, wallet };
    }

    it("sauce_wallet_send refuses a plan whose later cook the guard refuses, before the first is sent", async () => {
      const { server, wallet } = await walletServer("whole-plan", local.rpcUrl);
      try {
        const recipient = privateKeyToAccount(generatePrivateKey()).address;
        const noPot = getAddress(v12PredictPot(wallet, potSalt("never deployed")) as Address);
        const cookData = encodeFunctionData({
          abi: v12PotAbi,
          functionName: "cook",
          args: [getAddress(v12EngineAddress()), "0x00"],
        });
        const said = failed(
          await server.call("sauce_wallet_send", {
            wallet: "whole-plan",
            transaction: [
              { chainId: local.chain.id, to: recipient, data: "0x", value: "1000" },
              { chainId: local.chain.id, to: noPot, data: cookData as Hex, value: "0" },
            ],
          }),
        );
        assert.ok(said.includes("(2 of 2)"), said);
        assert.ok(said.includes(`the cook goes to ${noPot}, which has no code on ethereum`), said);
        assert.equal(await local.publicClient.getTransactionCount({ address: wallet }), 0);
        assert.equal(await local.publicClient.getBalance({ address: recipient }), 0n);
      } finally {
        await server.close();
      }
    });

    it("sauce_wallet_send waits for the Pot its plan's deployment made, on an endpoint that lags", async () => {
      // Its first answers to eth_getCode after a transaction are a node's that has not seen the block.
      const lagging = await laggingEndpoint(local.rpcUrl, 2);
      const { server, wallet } = await walletServer("lagging", lagging.url);
      try {
        const plan = ok(
          await server.call("sauce_tx", {
            source: PROGRAM,
            chain: "ethereum",
            owner: wallet,
            args: ["41"],
          }),
        );
        const sent = ok(
          await server.call("sauce_wallet_send", { wallet: "lagging", transaction: plan }),
        ) as { ok: boolean; sent: Array<{ status: string; reason?: string }> };
        assert.equal(sent.ok, true, JSON.stringify(sent.sent));
        assert.deepEqual(
          sent.sent.map((entry) => entry.status),
          ["success", "success"],
        );
        assert.ok(lagging.served() > 0);
      } finally {
        await server.close();
        await lagging.stop();
      }
    });
  },
);
