/**
 * Execution requires a deployed Pot authenticated against explicit fixture provenance. HTTP
 * supplies that binding per request; stdio may reuse its authenticated Pot store. Missing code,
 * mismatched identity and changed engine code fail closed, without deploying or repinning.
 * Retained legacy metadata remains listable but cannot select a different compiler implicitly.
 * Wallet plans still check every cook before sending any earlier transaction.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { encodeFunctionData, getAddress, parseEther, zeroHash, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { PotStore } from "../../sdk/dist/cli/pot-store.js";
import { potSalt } from "../../sdk/dist/deployments/pot.js";
import { v12PotAbi, type EvmPotBinding } from "../../sdk/dist/evm/engine.js";
import {
  deployPot,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { ELSEWHERE, mintOldReleasePot, OLD_RELEASE } from "../../sdk/test/evm/kitchen-releases.js";
import { createRpcGuard } from "../src/guard.js";
import { connect, endpointsFor, failed, ok, walletsAt, type Connected } from "./harness.js";

/** A fixture owner without a signing key. */
const NOBODY: Address = "0x5a0Ce0000000000000000000000000000000Beef";
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

describe(
  "the tools authenticate deployed Pot bindings",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let local: LocalChain;
    let dir: string;
    /** As over HTTP: no store. */
    let http: Connected;
    /** As over stdio: the `sauce` command's Pot store. */
    let stdio: Connected;
    let store: PotStore;
    let binding: EvmPotBinding;
    let pot: Address;
    let old: Address;
    const cook = { source: PROGRAM, chain: "ethereum", owner: NOBODY, args: ["41"] };

    before(async () => {
      local = await startChain("ethereum");
      dir = mkdtempSync(join(tmpdir(), "sauce-mcp-pot-guard-"));
      store = new PotStore(local.pots.dir);
      pot = await deployPot(local, NOBODY);
      binding = await local.bindingOf(pot);
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

    it("over HTTP, refuses missing deployed code before building or rehearsing a cook", async () => {
      const code = await local.publicClient.getCode({ address: pot });
      assert.ok(code);
      await local.testClient.setCode({ address: pot, bytecode: "0x" });
      try {
        for (const tool of ["sauce_tx", "sauce_simulate"]) {
          const said = failed(await http.call(tool, { ...cook, potBinding: binding }));
          assert.match(said, /not deployed|has no code/, tool);
          assert.doesNotMatch(said, /The Pot store/, tool);
        }
        assert.equal(await local.publicClient.getCode({ address: pot }), undefined);
      } finally {
        await local.testClient.setCode({ address: pot, bytecode: code });
      }
    });

    it("over stdio, lists retained metadata but refuses another compiler without repinning", async () => {
      // A legacy record has release metadata, not authenticated execution provenance.
      store.save({
        schema: "sauce.pot/1",
        chain: "ethereum",
        chainId: local.chain.id,
        pot: old,
        owner: NOBODY,
        salt: potSalt("another release"),
        kind: "private",
        kitchen: getAddress(OLD_RELEASE["kitchen-evm"].kitchen!),
        engine: getAddress(OLD_RELEASE["v12-evm"].engine!),
        release: {
          compiler: OLD_RELEASE.compiler,
          "v12-evm": OLD_RELEASE["v12-evm"].version,
          "kitchen-evm": OLD_RELEASE["kitchen-evm"].version,
        },
        sdk: "test",
        origin: "imported",
        recordedAt: "2026-10-31T00:00:00.000Z",
      });
      const listed = ok(await stdio.call("sauce_pot_list", { chain: "ethereum", owner: NOBODY }));
      const pots = listed.pots as Array<{ pot: string; release?: Record<string, string> }>;
      assert.deepEqual(pots.find((record) => getAddress(record.pot) === getAddress(old))?.release, {
        compiler: OLD_RELEASE.compiler,
        "v12-evm": OLD_RELEASE["v12-evm"].version,
        "kitchen-evm": OLD_RELEASE["kitchen-evm"].version,
      });
      for (const tool of ["sauce_tx", "sauce_simulate"]) {
        const said = failed(await stdio.call(tool, { ...cook, owner: undefined, pot: old }));
        assert.ok(said.includes(old), said);
        assert.match(said, /requires pinned compiler 2\.5\.0/, tool);
      }
      assert.equal(store.recordsOf(local.chain.id, old)[0]!.binding, undefined);
    });

    it("refuses a binding whose identity or engine code differs from the deployed fixture", async () => {
      for (const tool of ["sauce_tx", "sauce_simulate"]) {
        const identity = failed(
          await http.call(tool, {
            ...cook,
            owner: undefined,
            pot,
            potBinding: { ...binding, owner: ELSEWHERE },
          }),
        );
        assert.match(identity, /immutable|identity|historical creation commitment/, tool);
        const engine = failed(
          await http.call(tool, {
            ...cook,
            potBinding: { ...binding, engineCodeHash: zeroHash },
          }),
        );
        assert.match(engine, /engine code does not match the pinned release/, tool);
      }
    });

    it("builds and rehearses on the deployed fixture over HTTP and authenticated stdio", async () => {
      for (const mcp of [http, stdio]) {
        const input = mcp === http ? { ...cook, potBinding: binding } : cook;
        const tx = ok(await mcp.call("sauce_tx", input));
        assert.equal(tx.to, pot);
        assert.equal(tx.transactions, undefined);
        assert.deepEqual(tx.potBinding, binding);
        const simulated = ok(await mcp.call("sauce_simulate", input));
        assert.equal(simulated.ok, true);
        assert.equal(simulated.returned, "42");
        assert.deepEqual(simulated.potBinding, binding);
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
        const noPot = ELSEWHERE;
        const cookData = encodeFunctionData({
          abi: v12PotAbi,
          functionName: "cook",
          args: [binding.engine, "0x00"],
        });
        const said = failed(
          await server.call("sauce_wallet_send", {
            wallet: "whole-plan",
            transaction: [
              { chainId: local.chain.id, to: recipient, data: "0x", value: "1000" },
              { chainId: local.chain.id, to: noPot, data: cookData, value: "0" },
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

    it("sauce_wallet_send rejects a later cook with a mismatched engine before sending anything", async () => {
      const { server, wallet } = await walletServer("wrong-engine", local.rpcUrl);
      try {
        const pot = await deployPot(local, wallet);
        const potBinding = await local.bindingOf(pot);
        const recipient = privateKeyToAccount(generatePrivateKey()).address;
        const data = encodeFunctionData({
          abi: v12PotAbi,
          functionName: "cook",
          args: [ELSEWHERE, "0x00"],
        });
        const said = failed(
          await server.call("sauce_wallet_send", {
            wallet: "wrong-engine",
            transaction: [
              { chainId: local.chain.id, to: recipient, data: "0x", value: "1000" },
              { chainId: local.chain.id, to: potBinding.pot, data, value: "0" },
            ],
          }),
        );
        assert.ok(said.includes("(2 of 2)"), said);
        assert.match(said, /cook engine differs from Pot/);
        assert.equal(await local.publicClient.getTransactionCount({ address: wallet }), 0);
        assert.equal(await local.publicClient.getBalance({ address: recipient }), 0n);
      } finally {
        await server.close();
      }
    });

    it("sauce_wallet_send executes a plan only after explicit fixture deployment and authentication", async () => {
      const { server, wallet } = await walletServer("deployed", local.rpcUrl);
      try {
        const pot = await deployPot(local, wallet);
        const potBinding = await local.bindingOf(pot);
        const recipient = privateKeyToAccount(generatePrivateKey()).address;
        const plan = ok(
          await server.call("sauce_tx", {
            source: PROGRAM,
            chain: "ethereum",
            owner: wallet,
            args: ["41"],
          }),
        );
        assert.equal(plan.to, potBinding.pot);
        assert.equal(plan.transactions, undefined);
        const sent = ok(
          await server.call("sauce_wallet_send", {
            wallet: "deployed",
            transaction: [
              { chainId: local.chain.id, to: recipient, data: "0x", value: "1000" },
              plan,
            ],
          }),
        ) as { ok: boolean; sent: Array<{ status: string; reason?: string }> };
        assert.equal(sent.ok, true, JSON.stringify(sent.sent));
        assert.deepEqual(
          sent.sent.map((entry) => entry.status),
          ["success", "success"],
        );
        assert.equal(await local.publicClient.getTransactionCount({ address: wallet }), 2);
        assert.equal(await local.publicClient.getBalance({ address: recipient }), 1000n);
      } finally {
        await server.close();
      }
    });
  },
);
