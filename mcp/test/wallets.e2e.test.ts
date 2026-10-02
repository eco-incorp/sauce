/**
 * The wallet tools sending for real: a server with wallets (as `sauce mcp --wallets` over stdio
 * serves one) creates a wallet, lists it, and sends what its own tools built — `sauce_pot`'s
 * deployment and `sauce_tx`'s cook, passed to `sauce_wallet_send` whole — on a local anvil running
 * the released gated stack (`sdk/test/cli-anvil.ts`); a cook that would revert, and one above the
 * wallet's policy, are refused with nothing sent. And on Solana, in LiteSVM behind the shim that
 * checks every signature (`sdk/test/svm/rpc-shim.ts`): a transfer built for a Solana wallet as its
 * fee payer, signed and landed by the server, and one above its policy refused.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI (the harness throws on import there).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address as SvmAddress,
  type Blockhash,
} from "@solana/kit";
import { getAddress, parseEther, type Address, type Hex } from "viem";

import { decryptKeystoreBytes } from "../../sdk/dist/cli/signer.js";
import { WalletStore } from "../../sdk/dist/cli/wallets.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import {
  fixture,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import { ecoRoutesSvm } from "../../sdk/test/svm/eco-routes-svm.js";
import { solanaShim, type SolanaShim } from "../../sdk/test/svm/rpc-shim.js";
import { connect, endpointsFor, failed, ok, type Connected } from "./harness.js";

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");
const ZERO_SALT = `0x${"00".repeat(32)}` as Hex;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

/** A throwaway password, as the client config would pass one from an agent's .env. */
const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

describe("the wallet tools, sending on a chain", { skip: RUNTIME_HEX_PATH === undefined }, () => {
  let base: LocalChain;
  let usdc: Address;
  let dir: string;
  let mcp: Connected;
  let wallet: Address;
  let pot: Address;

  before(async () => {
    base = await startChain("base", await freePort());
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-e2e-"));
    mcp = await connect(endpointsFor({ [String(base.chain.id)]: base.rpcUrl }), undefined, {
      store: new WalletStore(join(dir, "wallets")),
      password: PASSWORD,
      source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
    });
  });
  after(async () => {
    await mcp?.close();
    await base?.stop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  const nonce = () => base.publicClient.getTransactionCount({ address: wallet });
  const cookOf = async (amount: bigint) =>
    ok(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        owner: wallet,
        args: [RECIPIENT, amount.toString()],
      }),
    );

  it("creates and lists a wallet, then sends sauce_pot's deployment from it", async () => {
    const created = ok(await mcp.call("sauce_wallet_create", { name: "agent" }));
    wallet = getAddress(String(created.address));
    const listed = ok(await mcp.call("sauce_wallet_list")) as {
      wallets: Array<{ name: string; address: string }>;
    };
    assert.deepEqual(
      listed.wallets.map((each) => each.address),
      [wallet],
    );
    await base.send(base.deployer, wallet, "0x", parseEther("1"));

    const deployment = ok(await mcp.call("sauce_pot", { chain: "base", owner: wallet }));
    pot = getAddress(String(deployment.pot));
    assert.equal(pot, v12PredictPot(wallet, ZERO_SALT));
    assert.equal(deployment.deployed, false);
    const sent = ok(
      await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: deployment }),
    ) as { ok: boolean; from: string; sent: Array<{ hash: Hex; status: string }> };
    assert.equal(sent.ok, true);
    assert.equal(sent.from, wallet);
    assert.equal(sent.sent.length, 1);
    assert.equal(sent.sent[0]!.status, "success");
    const receipt = await base.publicClient.getTransactionReceipt({ hash: sent.sent[0]!.hash });
    assert.equal(getAddress(receipt.from), wallet);
    assert.notEqual(await base.publicClient.getCode({ address: pot }), undefined);
    assert.ok(
      ((sent as { notes?: string[] }).notes ?? []).some((note) => /no limits are set/.test(note)),
    );
  });

  it("sends sauce_tx's cook, and two cooks rehearsed together", async () => {
    await base.mint(usdc, pot, 10_000_000n);
    const cook = await cookOf(1_000_000n);
    const sent = ok(await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: cook }));
    assert.equal(sent.ok, true);
    assert.equal(await base.balanceOf(usdc, RECIPIENT), 1_000_000n);
    const both = ok(
      await mcp.call("sauce_wallet_send", {
        wallet: "agent",
        transaction: [await cookOf(2_000_000n), await cookOf(3_000_000n)],
      }),
    ) as { sent: Array<{ status: string }> };
    assert.deepEqual(
      both.sent.map((each) => each.status),
      ["success", "success"],
    );
    assert.equal(await base.balanceOf(usdc, RECIPIENT), 6_000_000n);
  });

  it("refuses, sending nothing, a plan whose second cook would revert", async () => {
    const before = await nonce();
    // The Pot holds 4 USDC: the first takes 3, the second cannot have 3 more.
    const refusal = failed(
      await mcp.call("sauce_wallet_send", {
        wallet: "agent",
        transaction: [await cookOf(3_000_000n), await cookOf(3_000_000n)],
      }),
    );
    assert.match(refusal, /not sent — transaction 2 \(2 of 2\) would revert/);
    assert.equal(await nonce(), before);
    assert.equal(await base.balanceOf(usdc, RECIPIENT), 6_000_000n);
  });

  it("refuses a cook above the wallet's policy, naming the limit", async () => {
    writeFileSync(
      join(dir, "wallets", "agent.policy.json"),
      JSON.stringify({ tokens: { USDC: { perTransaction: "1" } } }),
      { mode: 0o600 },
    );
    const before = await nonce();
    const refusal = failed(
      await mcp.call("sauce_wallet_send", {
        wallet: "agent",
        transaction: await cookOf(2_000_000n),
      }),
    );
    assert.match(
      refusal,
      /refused by the policy of wallet agent .*tokens\.USDC\.perTransaction is 1 USDC, and this transaction sends 2 USDC/,
    );
    assert.equal(await nonce(), before);
    const within = ok(
      await mcp.call("sauce_wallet_send", {
        wallet: "agent",
        transaction: await cookOf(1_000_000n),
      }),
    ) as { policy: string | null };
    assert.match(String(within.policy), /agent\.policy\.json$/);
    assert.equal(await base.balanceOf(usdc, RECIPIENT), 7_000_000n);
  });

  it("never returned the wallet's key or the password", () => {
    const { bytes } = decryptKeystoreBytes(
      readFileSync(join(dir, "wallets", "agent.json"), "utf8"),
      PASSWORD,
    );
    const key = Buffer.from(bytes).toString("hex");
    for (const text of mcp.received) {
      assert.ok(!text.toLowerCase().includes(key));
      assert.ok(!text.includes(PASSWORD));
    }
  });
});

describe("the wallet tools, sending on Solana", () => {
  const SOLANA_URL = "http://127.0.0.1:65532/";
  let svm: ReturnType<typeof ecoRoutesSvm>;
  let shim: SolanaShim;
  let dir: string;
  let mcp: Connected;
  let wallet: SvmAddress;
  const recipient = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

  /** A System transfer of `amount` lamports from the wallet, built for it as its fee payer. */
  const transfer = (amount: bigint): string => {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);
    view.setBigUint64(4, amount, true);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(wallet, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: svm.latestBlockhash() as Blockhash, lastValidBlockHeight: 1_000_000n },
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address("11111111111111111111111111111111"),
            accounts: [
              { address: wallet, role: AccountRole.WRITABLE_SIGNER },
              { address: recipient, role: AccountRole.WRITABLE },
            ],
            data,
          },
          m,
        ),
    );

    return getBase64EncodedWireTransaction(compileTransaction(message));
  };

  before(async () => {
    svm = ecoRoutesSvm(1_790_000_000n);
    shim = solanaShim(svm, SOLANA_URL);
    shim.install();
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-solana-"));
    mcp = await connect(undefined, undefined, {
      store: new WalletStore(join(dir, "wallets")),
      password: PASSWORD,
      source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
    });
  });
  after(async () => {
    shim?.restore();
    await mcp?.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it("signs and lands a transfer built for a Solana wallet, and refuses one above its policy", async () => {
    const created = ok(await mcp.call("sauce_wallet_create", { name: "sol", kind: "solana" }));
    wallet = address(String(created.address));
    svm.airdrop(wallet, lamports(2_000_000_000n));
    const sent = ok(
      await mcp.call("sauce_wallet_send", {
        wallet: "sol",
        transaction: { transaction: transfer(10_000_000n) },
        rpcUrl: SOLANA_URL,
      }),
    ) as { ok: boolean; chain: string; sent: Array<{ hash: string; status: string }> };
    assert.equal(sent.ok, true);
    assert.equal(sent.chain, "solana");
    assert.equal(sent.sent[0]!.status, "success");
    assert.equal(svm.getBalance(recipient), 10_000_000n);
    // The shim checked the wallet's signature on what it was sent.
    assert.equal(Object.keys(shim.sent.at(-1)!.signatures)[0], wallet);

    writeFileSync(
      join(dir, "wallets", "sol.policy.json"),
      JSON.stringify({ native: { perTransaction: "0.005" } }),
      { mode: 0o600 },
    );
    const count = shim.sent.length;
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "sol",
          transaction: { transaction: transfer(10_000_000n) },
          rpcUrl: SOLANA_URL,
        }),
      ),
      /native\.perTransaction is 0\.005 SOL, and this transaction sends 0\.010005 SOL/,
    );
    assert.equal(shim.sent.length, count);
    assert.equal(svm.getBalance(recipient), 10_000_000n);
    assert.ok(mcp.received.every((text) => !text.includes(PASSWORD)));
  });
});
