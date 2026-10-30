import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { decodeFunctionData, getAddress, keccak256 } from "viem";
import * as z from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { getVerifiedPotBinding } from "../../sdk/dist/cli/pot-binding.js";
import { POT_SCHEMA, PotStore } from "../../sdk/dist/cli/pot-store.js";
import { signedCookTypedData, v12PotAbi, type EvmPotBinding } from "../../sdk/dist/evm/engine.js";
import {
  DEPLOYER,
  DEPLOYER_KEY,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { connect, endpointsFor, erred, failed, ok, walletsAt, type Connected } from "./harness.js";
import { POT_BINDING } from "../src/tools.js";
import { createRpcGuard } from "../src/guard.js";
import { DEFAULT_MAX_BODY, endpointUrl, serveHttp } from "../src/http.js";
import { createSauceServer } from "../src/server.js";

const SOURCE = "function main(x: Uint256): Uint256 { return x + 1; }";
const ACTIONS = { version: 1, actions: [{ type: "wrapETH", weth: "WETH", amount: "1" }] };
const hex = z
  .templateLiteral(["0x", z.string()])
  .refine((value) => /^0x(?:[0-9a-fA-F]{2})*$/.test(value));
const TRANSACTION = z.object({ to: POT_BINDING.shape.pot, data: hex, value: z.string() });

// Removing the request schema must not let caller-supplied proof or malformed identity reach RPC.
it("rejects malformed Pot bindings at the MCP boundary without reading a chain", async () => {
  const server = await connect();
  try {
    for (const potBinding of [null, {}, { pot: "not-an-address" }, { verified: true }]) {
      const result = await server.call("sauce_tx", {
        source: SOURCE,
        chain: "ethereum",
        owner: DEPLOYER.address,
        args: ["41"],
        potBinding,
      });
      assert.equal(result.isError, true);
      assert.match(failed(result), /potBinding|Invalid arguments/i);
      assert.equal(result.structuredContent, undefined);
    }
    const compiled = ok(await server.call("sauce_compile", { source: SOURCE, chain: "ethereum" }));
    assert.match(String(compiled.bytecode), /^0x/);
    assert.equal(compiled.potBinding, undefined);
    const actions = ok(await server.call("sauce_actions", { program: ACTIONS, chain: "ethereum" }));
    assert.match(String(actions.bytecode), /^0x/);
    assert.equal(actions.transaction, undefined);
    assert.equal(actions.potBinding, undefined);
  } finally {
    await server.close();
  }
});

describe(
  "stateless MCP executes only explicitly authenticated deployed EVM Pots",
  {
    skip: RUNTIME_HEX_PATH === undefined,
  },
  () => {
    let local: LocalChain;
    let server: Connected;
    let binding: EvmPotBinding;
    const call = () => ({ source: SOURCE, chain: "ethereum", pot: binding.pot, args: ["41"] });

    before(async () => {
      local = await startChain("ethereum");
      binding = await local.bindingOf(local.seedPot);
      // No stores, wallets or paths: the same tool context HTTP receives.
      server = await connect(endpointsFor({ "1": local.rpcUrl }));
    });
    after(async () => {
      await server?.close();
      await local?.stop();
    });

    it("builds and executes an actual cook with a verified binding and no server Pot store", async () => {
      const stored = local.pots.list();
      const output = ok(await server.call("sauce_tx", { ...call(), potBinding: binding }));
      const tx = TRANSACTION.parse(output);
      assert.equal(getAddress(String(tx.to)), binding.pot);
      assert.equal(output.deployPot, undefined);
      const decoded = decodeFunctionData({ abi: v12PotAbi, data: tx.data });
      assert.equal(decoded.functionName, "cook");
      assert.equal(getAddress(String(decoded.args![0])), binding.engine);
      const proof = POT_BINDING.parse(output.potBinding);
      assert.equal(proof.pot, binding.pot);
      assert.equal(
        proof.codeHash,
        keccak256((await local.publicClient.getCode({ address: binding.pot }))!),
      );
      assert.equal(proof.engine, binding.engine);
      assert.equal(proof.compiler, binding.compiler);
      assert.equal(proof.originalChainId, "1");
      const result = await local.publicClient.call({
        account: DEPLOYER.address,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
      });
      assert.equal(BigInt(result.data!), 42n);
      assert.deepEqual(
        local.pots.list(),
        stored,
        "stateless tools never persist in the harness store",
      );
      assert.equal(getVerifiedPotBinding(), undefined, "proof does not escape the request scope");
    });

    it("refuses a missing binding after a successful call instead of reusing request state", async () => {
      ok(await server.call("sauce_tx", { ...call(), potBinding: binding }));
      for (const tool of ["sauce_tx", "sauce_signed_cook", "sauce_simulate"]) {
        assert.match(failed(await server.call(tool, call())), /binding|provenance|store/i);
      }
    });

    it("refuses wrong chain, code, engine, compiler, release and profiles without sending", async () => {
      const block = await local.publicClient.getBlockNumber();
      const altered = [
        { ...binding, chainId: 8453 },
        { ...binding, pot: "0x0000000000000000000000000000000000000123" },
        { ...binding, engine: binding.router },
        { ...binding, engine: binding.router, engineCodeHash: binding.routerCodeHash },
        { ...binding, codeHash: `0x${"ff".repeat(32)}` },
        { ...binding, compiler: "unknown-compiler" },
        { ...binding, release: { ...binding.release, compiler: "unknown-compiler" } },
        ...(binding.profile === undefined
          ? []
          : [
              {
                ...binding,
                profile: { ...binding.profile, runtimeTemplateHash: `0x${"ff".repeat(32)}` },
              },
            ]),
        ...(binding.compatibilityProbe === undefined
          ? []
          : [undefined, "", "AA".repeat(32), `0x${"aa".repeat(32)}`, "00".repeat(32)].map(
              (compilerWasmSha256) => ({
                ...binding,
                compatibilityProbe: { ...binding.compatibilityProbe, compilerWasmSha256 },
              }),
            )),
        ...(binding.compatibilityProbe === undefined
          ? []
          : [
              {
                ...binding,
                compatibilityProbe: { ...binding.compatibilityProbe, program: "0x00" },
              },
            ]),
      ];
      for (const potBinding of altered) {
        for (const tool of ["sauce_tx", "sauce_signed_cook", "sauce_simulate"]) {
          const result = await server.call(tool, { ...call(), potBinding });
          assert.equal(result.isError, true, `${tool} accepted ${JSON.stringify(potBinding)}`);
          assert.equal(
            result.structuredContent,
            undefined,
            "refusal returns no proof, signature or transaction",
          );
        }
      }
      assert.equal(
        await local.publicClient.getBlockNumber(),
        block,
        "no deployment or send occurs",
      );
    });

    it("builds an actions cook only with a real binding and returns actual provenance", async () => {
      const request = { program: ACTIONS, chain: "ethereum", pot: binding.pot };
      const output = ok(await server.call("sauce_actions", { ...request, potBinding: binding }));
      assert.equal(TRANSACTION.parse(output.transaction).to, binding.pot);
      assert.equal(POT_BINDING.parse(output.potBinding).codeHash, binding.codeHash);
      assert.match(
        failed(await server.call("sauce_actions", request)),
        /binding|provenance|store/i,
      );
    });

    it("refuses missing expected code without deploying a replacement or emitting proof", async () => {
      const code = await local.publicClient.getCode({ address: binding.pot });
      assert.ok(code);
      await local.testClient.setCode({ address: binding.pot, bytecode: "0x" });
      try {
        for (const tool of ["sauce_tx", "sauce_signed_cook", "sauce_simulate"]) {
          const result = await server.call(tool, { ...call(), potBinding: binding });
          assert.match(failed(result), /no code|not deployed|missing/i);
          assert.equal(result.structuredContent, undefined);
          assert.equal(await local.publicClient.getCode({ address: binding.pot }), undefined);
        }
      } finally {
        await local.testClient.setCode({ address: binding.pot, bytecode: code });
      }
    });

    it("returns authenticated signed-cook data, checks an external signature, and never deploys", async () => {
      const request = { ...call(), potBinding: binding, nonce: "19", within: "3600" };
      const unsigned = ok(await server.call("sauce_signed_cook", request));
      assert.equal(unsigned.engine, binding.engine);
      assert.equal(unsigned.deployPot, undefined);
      assert.equal(POT_BINDING.parse(unsigned.potBinding).codeHash, binding.codeHash);
      const execution = z
        .object({
          chainId: z.number(),
          pot: POT_BINDING.shape.pot,
          engine: POT_BINDING.shape.engine,
          program: hex,
          value: z.string().transform(BigInt),
          maxExecutionFee: z.string().transform(BigInt),
          nonce: z.string().transform(BigInt),
          deadline: z.string().transform(BigInt),
          submitter: POT_BINDING.shape.owner,
        })
        .parse(unsigned);
      const signature = await DEPLOYER.signTypedData(
        signedCookTypedData({
          ...execution,
          compiler: binding.compiler,
        }),
      );
      const signed = ok(await server.call("sauce_signed_cook", { ...request, signature }));
      assert.equal(signed.signature, signature);
      assert.equal(TRANSACTION.parse(signed.cook).to, binding.pot);
      assert.equal(POT_BINDING.parse(signed.potBinding).engine, binding.engine);
    });

    it("simulates isolated scenarios, retains proof in summary, and never sends", async () => {
      const block = await local.publicClient.getBlockNumber();
      const simulation = ok(
        await server.call("sauce_simulate", {
          ...call(),
          potBinding: binding,
          summary: true,
          scenarios: [{ args: ["41"] }, { args: ["42"] }],
        }),
      );
      const scenarios = z
        .array(z.object({ ok: z.boolean(), returned: z.string() }))
        .parse(simulation.scenarios);
      assert.deepEqual(
        scenarios.map((each) => [each.ok, each.returned]),
        [
          [true, "42"],
          [true, "43"],
        ],
      );
      assert.equal(POT_BINDING.parse(simulation.potBinding).pot, binding.pot);
      const missing = erred(
        await server.call("sauce_simulate", {
          ...call(),
          scenarios: [{ args: ["41"] }, { args: ["42"] }],
        }),
      );
      assert.equal(missing.ok, false);
      assert.equal(missing.potBinding, undefined);
      assert.equal(await local.publicClient.getBlockNumber(), block);
    });

    it("isolates concurrent valid and conflicting requests, including their returned proof", async () => {
      const results = await Promise.all([
        server.call("sauce_tx", { ...call(), potBinding: binding }),
        server.call("sauce_signed_cook", {
          ...call(),
          potBinding: { ...binding, engine: binding.router },
        }),
        server.call("sauce_tx", call()),
      ]);
      assert.equal(POT_BINDING.parse(ok(results[0]!).potBinding).engine, binding.engine);
      failed(results[1]!);
      failed(results[2]!);
      assert.equal(getVerifiedPotBinding(), undefined);
    });

    it("keeps HTTP stateless and wallet-free while accepting a real explicit binding", async () => {
      const stored = local.pots.list();
      const http = await serveHttp({
        port: 0,
        host: "127.0.0.1",
        allowedHosts: [],
        maxBody: DEFAULT_MAX_BODY,
        server: () =>
          createSauceServer({
            endpoints: endpointsFor({ "1": local.rpcUrl }),
            guard: createRpcGuard({ allowPrivate: true }),
          }),
      });
      const client = new Client({ name: "stateless-binding-test", version: "0.0.0" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(endpointUrl(http, "127.0.0.1"))),
        );
        const { tools } = await client.listTools();
        for (const name of [
          "sauce_sign",
          "sauce_wallet_import",
          "sauce_pot_import",
          "sauce_pot_list",
        ]) {
          assert.ok(!tools.some((tool) => tool.name === name), name);
        }
        const output = (await client.callTool({
          name: "sauce_tx",
          arguments: { ...call(), potBinding: binding },
        })) as CallToolResult;
        assert.equal(POT_BINDING.parse(ok(output).potBinding).pot, binding.pot);
        const missing = (await client.callTool({
          name: "sauce_tx",
          arguments: call(),
        })) as CallToolResult;
        failed(missing);
        const path = (await client.callTool({
          name: "sauce_tx",
          arguments: { ...call(), potBinding: binding, path: "/tmp/never-read" },
        })) as CallToolResult;
        assert.match(failed(path), /path|Unrecognized/i);
        assert.deepEqual(local.pots.list(), stored);
      } finally {
        await client.close();
        await promisify(http.close.bind(http))();
      }
    });

    it("signs with a stdio wallet only after the explicit deployed binding verifies", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sauce-mcp-binding-wallet-"));
      const key = join(dir, "key");
      writeFileSync(key, DEPLOYER_KEY, { mode: 0o600 });
      const stdio = await connect(
        endpointsFor({ "1": local.rpcUrl }),
        undefined,
        walletsAt(join(dir, "wallets"), { start: "local-binding-fixture-password" }),
        true,
      );
      try {
        ok(await stdio.call("sauce_wallet_import", { name: "owner", path: key }));
        for (const potBinding of [undefined, { ...binding, engine: binding.router }]) {
          const refusal = await stdio.call("sauce_sign", {
            ...call(),
            wallet: "owner",
            ...(potBinding === undefined ? {} : { potBinding }),
          });
          failed(refusal);
          assert.equal(refusal.structuredContent, undefined);
        }
        const signed = ok(
          await stdio.call("sauce_sign", { ...call(), wallet: "owner", potBinding: binding }),
        );
        assert.match(String(signed.signature), /^0x[0-9a-f]{130}$/i);
        assert.equal(TRANSACTION.parse(signed.cook).to, binding.pot);
        assert.equal(POT_BINDING.parse(signed.potBinding).engine, binding.engine);
      } finally {
        await stdio.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps configured stdio Pot stores working without an explicit request binding", async () => {
      local.pots.save({
        schema: POT_SCHEMA,
        chain: "ethereum",
        chainId: 1,
        pot: binding.pot,
        owner: binding.owner,
        salt: binding.userSalt,
        kind: binding.kind,
        kitchen: binding.kitchen,
        engine: binding.engine,
        release: binding.release,
        binding,
        sdk: "LOCAL",
        origin: "imported",
        recordedAt: new Date().toISOString(),
      });
      const stdio = await connect(endpointsFor({ "1": local.rpcUrl }), undefined, undefined, true, {
        pots: new PotStore(local.pots.dir),
      });
      try {
        const tx = ok(await stdio.call("sauce_tx", call()));
        assert.equal(getAddress(String(tx.to)), binding.pot);
        assert.equal(POT_BINDING.parse(tx.potBinding).codeHash, binding.codeHash);
        for (const field of ["wireProfile", "storageProfile"] as const) {
          const refusal = await stdio.call("sauce_tx", {
            ...call(),
            potBinding: { ...binding, [field]: "different-persisted-pin" },
          });
          assert.match(failed(refusal), /persisted|pins|binding/i);
          assert.equal(refusal.structuredContent, undefined);
        }
      } finally {
        await stdio.close();
      }
    });
  },
);
