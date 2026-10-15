/**
 * A local server keeping the `sauce` command's Pot store, as `sauce mcp` over stdio does: a Pot
 * deployment the caller signed and sauce_send broadcast is recorded once it lands, as the command
 * records one, and said in the result's notes; sauce_pot_list reads it back, and sauce_pot_import
 * records a Pot deployed some other way. A server that keeps no store (over HTTP, or with
 * `--no-stores`) writes nothing and has neither tool, while its results still carry the record.
 *
 * On a local anvil running the released gated stack (`sdk/test/cli-anvil.ts`). GATED on
 * SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure without it in
 * CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { PotStore, type PotRecord } from "../../sdk/dist/cli/pot-store.js";
import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { v12KitchenAbi } from "../../sdk/dist/evm/engine.js";
import { RUNTIME_HEX_PATH, startChain, type LocalChain } from "../../sdk/test/cli-anvil.js";
import type { Endpoints } from "../src/config.js";
import { createRpcGuard } from "../src/guard.js";
import { POT_TOOL_NAMES } from "../src/pots.js";
import { createSauceServer } from "../src/server.js";
import { endpointsFor, ok } from "./harness.js";

/** A server in process, as `sauce mcp` builds one over stdio, keeping `pots` when given. */
async function serve(endpoints: Endpoints, pots?: PotStore) {
  const server = createSauceServer({
    endpoints,
    local: true,
    ...(pots === undefined ? {} : { stores: { pots } }),
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "sauce-mcp-pots", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("a local server keeping the Pot store", { skip: RUNTIME_HEX_PATH === undefined }, () => {
  let base: LocalChain;
  let dir: string;
  let store: PotStore;
  let endpoints: Endpoints;
  // A signer the server never sees, standing in for a KMS or a hardware wallet.
  const signer = privateKeyToAccount(generatePrivateKey());

  before(async () => {
    base = await startChain("base");
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-pots-"));
    store = new PotStore(join(dir, "pots"));
    endpoints = endpointsFor({ [String(base.chain.id)]: base.rpcUrl });
    await base.deployer.sendTransaction({
      account: base.deployer.account!,
      chain: null,
      to: signer.address,
      value: 10n ** 18n,
    });
  });
  after(async () => {
    await base?.stop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  /** sauce_pot's deployment of `owner`'s Pot at `salt`, signed by the signer. */
  const signedDeployment = async (
    call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
    salt: string,
  ) => {
    const built = ok(await call("sauce_pot", { chain: "base", owner: signer.address, salt }));
    const request = { to: built.to as Address, data: built.data as Hex, value: 0n };
    const fees = await base.publicClient.estimateFeesPerGas();

    return {
      pot: getAddress(built.pot as string),
      signed: await signer.signTransaction({
        chainId: base.chain.id,
        type: "eip1559",
        ...request,
        nonce: await base.publicClient.getTransactionCount({ address: signer.address }),
        gas: (await base.publicClient.estimateGas({ account: signer.address, ...request })) * 2n,
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      }),
    };
  };

  it("records the Pot a deployment sent through sauce_send deploys, and lists and imports Pots", async () => {
    const mcp = await serve(endpoints, store);
    try {
      const { tools } = await mcp.client.listTools();
      assert.deepEqual(
        tools.filter((tool) => tool.name.startsWith("sauce_pot_")).map((tool) => tool.name),
        [...POT_TOOL_NAMES],
      );
      // A send says what this server does with the records: it keeps them.
      assert.match(
        tools.find((tool) => tool.name === "sauce_send")!.description ?? "",
        /which this server also records in the sauce command's Pot store/,
      );
      assert.deepEqual(ok(await mcp.call("sauce_pot_list")), { store: store.dir, pots: [] });

      const { pot, signed } = await signedDeployment(mcp.call, "local");
      const sent = await mcp.call("sauce_send", { transactions: [signed] });
      const out = ok(sent) as {
        sent: Array<{ hash: Hex; status: string; pots?: PotRecord[] }>;
        notes: string[];
      };
      assert.equal(out.sent[0]!.status, "success");
      // Written as it landed, as the command writes it, and said in the result.
      assert.ok(
        out.notes.includes(`recorded Pot ${pot} on base in ${store.dir}`),
        String(out.notes),
      );
      const [record] = store.list().pots;
      assert.deepEqual(out.sent[0]!.pots, [record]);
      assert.deepEqual(
        [record!.pot, record!.owner, record!.kind, record!.origin, record!.deployment?.tx],
        [pot, signer.address, "private", "deployed", out.sent[0]!.hash],
      );
      assert.equal(record!.salt, keccak256(stringToBytes("local")));

      // sauce_pot_list reads it back, by chain and by owner.
      assert.deepEqual(ok(await mcp.call("sauce_pot_list", { chain: "base" })).pots, [record]);
      assert.deepEqual(
        ok(await mcp.call("sauce_pot_list", { owner: signer.address.toLowerCase() })).pots,
        [record],
      );
      assert.deepEqual(ok(await mcp.call("sauce_pot_list", { chain: "ethereum" })).pots, []);

      // Recorded already: kept as it was.
      const again = ok(await mcp.call("sauce_pot_import", { chain: "base", pot })) as {
        notes: string[];
      };
      assert.match(
        again.notes.join("\n"),
        /was already recorded in .*; the record is kept as it was/,
      );
      assert.deepEqual(store.list().pots, [record]);

      // A Shared Pot someone else minted, straight on the Kitchen: imported, its kind told.
      const kitchen = getAddress(v12KitchenAddress());
      const salt = keccak256(stringToBytes("shared by mcp"));
      const shared = getAddress(
        (await base.publicClient.readContract({
          address: kitchen,
          abi: v12KitchenAbi,
          functionName: "predictSharedPot",
          args: [salt],
        })) as Address,
      );
      await base.send(
        base.deployer,
        kitchen,
        encodeFunctionData({ abi: v12KitchenAbi, functionName: "deploySharedPot", args: [salt] }),
      );
      const imported = ok(await mcp.call("sauce_pot_import", { chain: "base", pot: shared })) as {
        pots: PotRecord[];
      };
      assert.deepEqual(
        imported.pots.map((one) => [one.pot, one.kind, one.origin]),
        [[shared, "shared", "imported"]],
      );
      assert.equal(store.list().pots.length, 2);
    } finally {
      await mcp.close();
    }
  });

  it("keeps nothing, and has neither tool, where it keeps no store; its results still carry the record", async () => {
    const mcp = await serve(endpoints);
    try {
      const { tools } = await mcp.client.listTools();
      assert.ok(tools.every((tool) => !tool.name.startsWith("sauce_pot_")));
      assert.match(
        tools.find((tool) => tool.name === "sauce_send")!.description ?? "",
        /to keep: this server keeps none/,
      );
      const { pot, signed } = await signedDeployment(mcp.call, "unkept");
      const out = ok(await mcp.call("sauce_send", { transactions: [signed] })) as {
        sent: Array<{ pots?: PotRecord[] }>;
        notes?: string[];
      };
      assert.deepEqual(
        out.sent[0]!.pots?.map((one) => one.pot),
        [pot],
      );
      assert.ok(!(out.notes ?? []).some((note) => /recorded Pot/.test(note)));
      assert.ok(store.list().pots.every((one) => one.pot !== pot));
    } finally {
      await mcp.close();
    }
    // Over HTTP a server is never given a store.
    assert.throws(
      () =>
        createSauceServer({
          endpoints,
          guard: createRpcGuard({ allowPrivate: true }),
          stores: { pots: store },
        }),
      /keeps stores over stdio only/,
    );
  });
});
