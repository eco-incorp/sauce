/**
 * The wallet tools in process, with no endpoint: registered only on a server given wallets (which
 * only `sauce mcp --wallets` over stdio is), never taking or returning a key or the password, and
 * refusing what `sauce_wallet_send` cannot send before it reaches any chain. Sending on a chain is
 * `wallets.e2e.test.ts`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { decryptKeystoreBytes } from "../../sdk/dist/cli/signer.js";
import { WalletStore } from "../../sdk/dist/cli/wallets.js";
import { INTENT_TOOL_NAMES } from "../src/intents.js";
import { SKILL_TOOL_NAMES } from "../src/skilltools.js";
import { TOOL_NAMES, WALLET_UNSIGNED } from "../src/tools.js";
import { WALLET_TOOL_NAMES } from "../src/wallets.js";
import { connect, failed, ok, textOf, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("a server without wallets", () => {
  let mcp: Connected;
  before(async () => {
    mcp = await connect();
  });
  after(() => mcp.close());

  it("has no wallet tool, and says nothing here signs", async () => {
    const { tools } = await mcp.client.listTools();
    assert.ok(tools.every((tool) => !tool.name.startsWith("sauce_wallet")));
    assert.match(mcp.client.getInstructions() ?? "", /NOTHING HERE SIGNS OR SENDS/);
    assert.ok(tools.every((tool) => !(tool.description ?? "").includes("sauce_wallet_send")));
  });
});

describe("a server with wallets", () => {
  let dir: string;
  let mcp: Connected;
  const password = `throwaway-${process.pid}-${Date.now()}`;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-"));
    mcp = await connect(undefined, undefined, {
      store: new WalletStore(join(dir, "wallets")),
      password,
      source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
    });
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists the wallet tools after the intent tools, none taking a key or a password", async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...TOOL_NAMES, ...INTENT_TOOL_NAMES, ...WALLET_TOOL_NAMES, ...SKILL_TOOL_NAMES],
    );
    for (const tool of tools) {
      for (const field of Object.keys(tool.inputSchema.properties ?? {})) {
        assert.doesNotMatch(field, /key|secret|password|mnemonic|seed|keystore|keypair/i);
      }
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get("sauce_wallet_send")?.annotations?.destructiveHint, true);
    assert.equal(byName.get("sauce_wallet_list")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("sauce_wallet_create")?.annotations?.destructiveHint, false);
    // Every tool that builds a transaction says it can be sent from a wallet here.
    for (const name of ["sauce_tx", "sauce_pot", "sauce_intent_fill", "sauce_intent_claim"]) {
      assert.ok(byName.get(name)?.description?.includes(WALLET_UNSIGNED), name);
    }
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /THIS SERVER SIGNS ONLY WITH THE WALLETS IN ITS WALLET DIRECTORY/);
    assert.match(instructions, /--password-env SAUCE_TEST_WALLET_PASSWORD/);
  });

  it("creates EVM and Solana wallets, returning addresses and never a key", async () => {
    const evm = ok(await mcp.call("sauce_wallet_create", { name: "agent" }));
    assert.match(String(evm.address), /^0x[0-9a-fA-F]{40}$/);
    assert.equal(evm.kind, "evm");
    assert.equal(evm.policy, null);
    assert.ok((evm.notes as string[]).some((note) => /no limits are set/.test(note)));
    assert.ok((evm.notes as string[]).some((note) => /hot wallet/.test(note)));
    const sol = ok(await mcp.call("sauce_wallet_create", { name: "sol", kind: "solana" }));
    assert.equal(sol.kind, "solana");
    assert.match(
      failed(await mcp.call("sauce_wallet_create", { name: "agent" })),
      /wallet agent exists: a wallet is never overwritten/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_create", { name: "Not A Name" })),
      /is not a wallet name/,
    );
    const listed = ok(await mcp.call("sauce_wallet_list")) as {
      wallets: Array<{ name: string; kind: string; address: string }>;
    };
    assert.deepEqual(
      listed.wallets.map((wallet) => [wallet.name, wallet.kind, wallet.address]),
      [
        ["agent", "evm", evm.address],
        ["sol", "solana", sol.address],
      ],
    );
    // Neither key, in any spelling, nor the password, ever came back.
    for (const name of ["agent", "sol"]) {
      const { bytes } = decryptKeystoreBytes(
        readFileSync(join(dir, "wallets", `${name}.json`), "utf8"),
        password,
      );
      const hex = Buffer.from(bytes).toString("hex");
      for (const text of mcp.received) {
        assert.ok(!text.toLowerCase().includes(hex.slice(0, 32)), `${name}'s key`);
        assert.ok(!text.includes(JSON.stringify([...bytes]).slice(1, 40)), `${name}'s keypair`);
      }
    }
    assert.ok(mcp.received.every((text) => !text.includes(password)));
  });

  it("refuses what it cannot send before any chain is read", async () => {
    const tx = { chainId: 8453, to: OWNER, data: "0x", value: "0" };
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "nobody", transaction: tx })),
      /no wallet nobody/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: { hello: 1 } })),
      /transaction is not a transaction/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: { ready: false, why: "the proof has not arrived", transactions: [] },
        }),
      ),
      /is not ready to send: the proof has not arrived/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: [tx, { ...tx, chainId: 1 }],
        }),
      ),
      /send each chain's in a call of its own/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "sol", transaction: tx })),
      /wallet sol is a Solana wallet, and these are EVM transactions/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: { to: OWNER, data: "0x", value: "0" },
        }),
      ),
      /name no chain: give chain/,
    );
    // No endpoint: the call can give one.
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: tx })),
      /Sending needs an RPC endpoint for base .* Pass rpcUrl with the call/,
    );
  });

  it("says, on a transaction it builds, that a wallet here can send it", async () => {
    const pot = ok(await mcp.call("sauce_pot", { chain: "base", owner: OWNER }));
    assert.ok(
      (pot.notes as string[]).some((note) =>
        /To send it from one of this server's wallets: sauce_wallet_send/.test(note),
      ),
      textOf({ content: [{ type: "text", text: JSON.stringify(pot.notes) }] }),
    );
    // A compile builds nothing to send.
    const compiled = ok(
      await mcp.call("sauce_compile", { source: "function main() {}\n", chain: "base" }),
    );
    assert.ok(
      ((compiled.notes as string[] | undefined) ?? []).every(
        (note) => !/sauce_wallet_send/.test(note),
      ),
    );
  });
});
