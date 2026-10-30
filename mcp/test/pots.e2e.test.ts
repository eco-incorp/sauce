/**
 * A local server keeps the `sauce` command's Pot store, as `sauce mcp` over stdio does.
 * Fixture setup deploys Pots explicitly; sauce_pot_import authenticates their trusted binding,
 * sauce_pot_list reads them back, and a signed cook uses the persisted provenance without
 * rewriting it. A server without stores writes nothing and has neither store tool.
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
  parseAbi,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { PotStore, type PotRecord } from "../../sdk/dist/cli/pot-store.js";
import { RUNTIME_HEX_PATH, startChain, type LocalChain } from "../../sdk/test/cli-anvil.js";
import type { Endpoints } from "../src/config.js";
import { createRpcGuard } from "../src/guard.js";
import { POT_TOOL_NAMES } from "../src/pots.js";
import { createSauceServer } from "../src/server.js";
import { deployedPotBinding, endpointsFor, failed, ok } from "./harness.js";

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
  let binding: Awaited<ReturnType<typeof deployedPotBinding>>;
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
    binding = await deployedPotBinding(base, signer.address, keccak256(stringToBytes("local")));
  });
  after(async () => {
    await base?.stop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  /** A cook for an explicitly deployed Pot, signed outside the server. */
  const signedCook = async (
    call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
    potBinding: Awaited<ReturnType<typeof deployedPotBinding>>,
  ) => {
    const built = ok(
      await call("sauce_tx", {
        source: "function main() {}",
        chain: "base",
        pot: potBinding.pot,
        potBinding,
      }),
    );
    assert.deepEqual(built.potBinding, potBinding);
    const request = {
      to: built.to as Address,
      data: built.data as Hex,
      value: BigInt(String(built.value)),
    };
    const fees = await base.publicClient.estimateFeesPerGas();

    return signer.signTransaction({
      chainId: base.chain.id,
      type: "eip1559",
      ...request,
      nonce: await base.publicClient.getTransactionCount({ address: signer.address }),
      gas: (await base.publicClient.estimateGas({ account: signer.address, ...request })) * 2n,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  };

  it("imports authenticated Pots, lists ownership, and keeps their bindings immutable after sending", async () => {
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

      const pot = binding.pot;
      const imported = ok(
        await mcp.call("sauce_pot_import", {
          chain: "base",
          pot,
          potBinding: binding,
        }),
      ) as { pots: PotRecord[]; notes: string[] };
      assert.ok(
        imported.notes.includes(`recorded Pot ${pot} on base in ${store.dir}`),
        String(imported.notes),
      );
      const [record] = store.list().pots;
      assert.deepEqual(imported.pots, [record]);
      assert.deepEqual(
        [record!.pot, record!.owner, record!.kind, record!.origin, record!.binding],
        [pot, signer.address, "private", "imported", binding],
      );
      assert.equal(record!.salt, keccak256(stringToBytes("local")));
      const signed = await signedCook(mcp.call, binding);
      const out = ok(await mcp.call("sauce_send", { transactions: [signed] })) as {
        sent: Array<{ hash: Hex; status: string }>;
      };
      assert.equal(out.sent[0]!.status, "success");
      const receipt = await base.publicClient.getTransactionReceipt({ hash: out.sent[0]!.hash });
      assert.equal(getAddress(receipt.from), signer.address);
      assert.equal(getAddress(receipt.to!), pot);
      assert.deepEqual(store.list().pots, [record]);

      // sauce_pot_list reads it back, by chain and by owner.
      assert.deepEqual(ok(await mcp.call("sauce_pot_list", { chain: "base" })).pots, [record]);
      assert.deepEqual(
        ok(await mcp.call("sauce_pot_list", { owner: signer.address.toLowerCase() })).pots,
        [record],
      );
      assert.deepEqual(ok(await mcp.call("sauce_pot_list", { chain: "ethereum" })).pots, []);

      // Recorded already: kept as it was.
      const again = ok(
        await mcp.call("sauce_pot_import", {
          chain: "base",
          pot,
          potBinding: binding,
        }),
      ) as { notes: string[] };
      assert.match(
        again.notes.join("\n"),
        /was already recorded in .*; the record is kept as it was/,
      );
      assert.deepEqual(store.list().pots, [record]);

      // Shared Pot creation is explicit fixture setup, never a production deployment fallback.
      const kitchen = binding.kitchen;
      const sharedAbi = parseAbi([
        "function predictSharedPot(bytes32 salt) view returns (address)",
        "function deploySharedPot(bytes32 salt) returns (address)",
      ]);
      const salt = keccak256(stringToBytes("shared by mcp"));
      const shared = getAddress(
        (await base.publicClient.readContract({
          address: kitchen,
          abi: sharedAbi,
          functionName: "predictSharedPot",
          args: [salt],
        })) as Address,
      );
      await base.send(
        base.deployer,
        kitchen,
        encodeFunctionData({ abi: sharedAbi, functionName: "deploySharedPot", args: [salt] }),
      );
      const sharedBinding = await base.bindingOf(shared);
      const importedShared = ok(
        await mcp.call("sauce_pot_import", {
          chain: "base",
          pot: shared,
          potBinding: sharedBinding,
        }),
      ) as { pots: PotRecord[] };
      assert.deepEqual(
        importedShared.pots.map((one) => [one.pot, one.kind, one.origin]),
        [[shared, "shared", "imported"]],
      );
      assert.equal(store.list().pots.length, 2);
      const records = store.list().pots;
      assert.match(
        failed(
          await mcp.call("sauce_pot_import", {
            chain: "base",
            pot,
            potBinding: { ...binding, owner: base.deployer.account!.address },
          }),
        ),
        /differs from persisted Pot pins|binding verification failed/,
      );
      assert.deepEqual(store.list().pots, records);
    } finally {
      await mcp.close();
    }
  });

  it("keeps nothing and has neither store tool without a store, including over HTTP", async () => {
    const mcp = await serve(endpoints);
    try {
      const { tools } = await mcp.client.listTools();
      assert.ok(tools.every((tool) => !tool.name.startsWith("sauce_pot_")));
      assert.match(
        tools.find((tool) => tool.name === "sauce_send")!.description ?? "",
        /to keep: this server keeps none/,
      );
      const unkept = await deployedPotBinding(
        base,
        signer.address,
        keccak256(stringToBytes("unkept")),
      );
      const before = store.list().pots;
      const signed = await signedCook(mcp.call, unkept);
      const nonce = await base.publicClient.getTransactionCount({ address: signer.address });
      assert.match(
        failed(await mcp.call("sauce_send", { transactions: [signed] })),
        /provide an explicit matching request binding/,
      );
      assert.equal(await base.publicClient.getTransactionCount({ address: signer.address }), nonce);
      const out = ok(
        await mcp.call("sauce_send", {
          transactions: [signed],
          potBinding: unkept,
        }),
      ) as {
        sent: Array<{ status: string }>;
        notes?: string[];
        potBinding?: unknown;
      };
      assert.equal(out.sent[0]!.status, "success");
      assert.deepEqual(out.potBinding, unkept);
      assert.ok(!(out.notes ?? []).some((note) => /recorded Pot/.test(note)));
      assert.deepEqual(store.list().pots, before);
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
