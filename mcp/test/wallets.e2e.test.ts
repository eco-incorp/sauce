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
import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
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

/** A throwaway password, as the client config would pass one from an agent's .env. */
const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

describe("the wallet tools, sending on a chain", { skip: RUNTIME_HEX_PATH === undefined }, () => {
  let base: LocalChain;
  let ethereum: LocalChain;
  let usdc: Address;
  let dir: string;
  let mcp: Connected;
  let wallet: Address;
  let pot: Address;

  before(async () => {
    [base, ethereum] = await Promise.all([startChain("base"), startChain("ethereum")]);
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-e2e-"));
    const endpoints = {
      [String(base.chain.id)]: base.rpcUrl,
      [String(ethereum.chain.id)]: ethereum.rpcUrl,
    };
    mcp = await connect(endpointsFor(endpoints), undefined, {
      store: new WalletStore(join(dir, "wallets")),
      password: PASSWORD,
      source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
    });
  });
  after(async () => {
    await mcp?.close();
    await Promise.all([base?.stop(), ethereum?.stop()]);
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
    // Beside the hash, the pages a person opens: the explorer and the trace.
    const hash = sent.sent[0]!.hash;
    assert.deepEqual(
      [
        (sent.sent[0] as Record<string, unknown>).explorer,
        (sent.sent[0] as Record<string, unknown>).trace,
      ],
      [
        `https://basescan.org/tx/${hash}`,
        `https://app.blocksec.com/phalcon/explorer/tx/base/${hash}`,
      ],
    );
    const receipt = await base.publicClient.getTransactionReceipt({ hash });
    assert.equal(getAddress(receipt.from), wallet);
    assert.notEqual(await base.publicClient.getCode({ address: pot }), undefined);
    assert.ok(
      ((sent as { notes?: string[] }).notes ?? []).some((note) => /no limits are set/.test(note)),
    );
  });

  it("sends sauce_tx's cook, and two cooks rehearsed together", async () => {
    await base.mint(usdc, pot, 10_000_000n);
    const cook = await cookOf(1_000_000n);
    const sent = ok(
      await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: cook }),
    ) as {
      ok: boolean;
      sent: Array<Record<string, unknown>>;
    };
    assert.equal(sent.ok, true);
    assert.equal(await base.balanceOf(usdc, RECIPIENT), 1_000_000n);
    // A cook's receipt, read back: what moved, by role, and the 9 USDC that stay in the Pot.
    const [landed] = sent.sent;
    assert.deepEqual(landed!.leftInPot, [
      {
        token: usdc,
        symbol: "USDC",
        decimals: 6,
        amount: "9000000",
        formatted: "9",
        before: "10000000",
      },
    ]);
    assert.deepEqual(
      (landed!.moves as Array<Record<string, unknown>>).map((move) => [
        move.fromRole,
        move.to,
        move.amount,
      ]),
      [["Pot", RECIPIENT, "1000000"]],
    );
    const summary = landed!.summary as string[];
    assert.deepEqual(summary.slice(0, 2), [
      "Left in the Pot, not in the wallet:",
      "  9 USDC (it held 10 USDC before)",
    ]);
    assert.ok(summary.includes("What moved, in order:"), summary.join("\n"));
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

  it("sends sauce_tx's plan for a Pot with no code, the deploy and then the cook, within `to`", async () => {
    const created = ok(await mcp.call("sauce_wallet_create", { name: "planner" }));
    const planner = getAddress(String(created.address));
    const plannerPot = getAddress(v12PredictPot(planner, ZERO_SALT) as Address);
    await base.send(base.deployer, planner, "0x", parseEther("1"));
    await base.mint(usdc, plannerPot, 1_000_000n);
    const planOf = async () =>
      ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner: planner,
          args: [RECIPIENT, "500000"],
        }),
      );
    const plan = await planOf();
    const steps = plan.transactions as Array<{ deploysPot?: string; to: string }>;
    assert.deepEqual(
      steps.map((step) => [step.deploysPot ?? null, getAddress(step.to)]),
      [
        [plannerPot, getAddress(v12KitchenAddress())],
        [null, plannerPot],
      ],
    );
    // A policy whose `to` is some other address: the deploy is refused, naming the Pot to add.
    const policy = join(dir, "wallets", "planner.policy.json");
    writeFileSync(policy, JSON.stringify({ to: [RECIPIENT] }), { mode: 0o600 });
    const refusal = failed(
      await mcp.call("sauce_wallet_send", { wallet: "planner", transaction: plan }),
    );
    assert.match(
      refusal,
      new RegExp(`deploys the wallet's Pot ${plannerPot}, which is not one of them: add it to to`),
    );
    assert.equal(await base.publicClient.getTransactionCount({ address: planner }), 0);
    // With the Pot in `to`, its own deploy is allowed too: both are sent, in order.
    writeFileSync(policy, JSON.stringify({ to: [plannerPot] }), { mode: 0o600 });
    const sent = ok(
      await mcp.call("sauce_wallet_send", { wallet: "planner", transaction: await planOf() }),
    ) as { ok: boolean; sent: Array<{ status: string }> };
    assert.equal(sent.ok, true);
    assert.deepEqual(
      sent.sent.map((each) => each.status),
      ["success", "success"],
    );
    assert.notEqual(await base.publicClient.getCode({ address: plannerPot }), undefined);
    assert.equal(await base.balanceOf(usdc, plannerPot), 500_000n);
  });

  it("sends a plan on two chains chain by chain, in its order", async () => {
    // As a cook whose remote message readies the Pot on another chain first plans it: that chain's
    // transactions, then the cook's own chain's.
    await ethereum.send(ethereum.deployer, wallet, "0x", parseEther("1"));
    const before = await Promise.all([
      ethereum.publicClient.getBalance({ address: RECIPIENT }),
      base.publicClient.getBalance({ address: RECIPIENT }),
    ]);
    const sent = ok(
      await mcp.call("sauce_wallet_send", {
        wallet: "agent",
        transaction: [
          { chainId: 1, to: RECIPIENT, data: "0x", value: "3" },
          { chainId: 8453, to: RECIPIENT, data: "0x", value: "5" },
        ],
      }),
    ) as { ok: boolean; chains: string[]; sent: Array<{ status: string; chain: string }> };
    assert.equal(sent.ok, true);
    assert.deepEqual(sent.chains, ["ethereum", "base"]);
    assert.deepEqual(
      sent.sent.map((entry) => [entry.chain, entry.status]),
      [
        ["ethereum", "success"],
        ["base", "success"],
      ],
    );
    assert.equal(await ethereum.publicClient.getBalance({ address: RECIPIENT }), before[0] + 3n);
    assert.equal(await base.publicClient.getBalance({ address: RECIPIENT }), before[1] + 5n);
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
