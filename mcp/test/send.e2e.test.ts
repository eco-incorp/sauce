/**
 * The whole path through the tools alone, with a signer the server never sees: sauce_tx builds,
 * the test signs (a throwaway key standing in for a KMS or a hardware wallet), sauce_send
 * broadcasts and reports.
 *
 * Ethereum, an anvil running the released gated stack (`sdk/test/cli-anvil.ts`): the plan for an
 * owner with no Pot yet — Kitchen.deployPot, then the cook — signed with consecutive nonces and
 * sent in one call. Solana, the released Kitchen and engine in LiteSVM behind
 * `sdk/test/svm/rpc-shim.ts`, which checks every signature it is sent: the one-transaction cook,
 * its Pot created in it, signed by the owner's keypair.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and on the engine artifacts respectively, like every
 * execution suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, hexToBigInt, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../sdk/dist/deployments/index.js";
import { WalletStore } from "../../sdk/dist/cli/wallets.js";
import { derivePotPda } from "../../sdk/dist/svm/index.js";
import {
  fixture,
  registered,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../sdk/test/cli-anvil.js";
import {
  ENGINE_SO,
  randomAddress,
  setMint,
  setTokenAccount,
  startEngine,
  svmArtifactsPresent,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "../../sdk/test/svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "../../sdk/test/svm/rpc-shim.js";
import { connect, endpointsFor, ok, type Connected } from "./harness.js";

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

interface Unsigned {
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
}

describe(
  "sauce_tx, signed elsewhere, sent by sauce_send: Ethereum",
  {
    skip: RUNTIME_HEX_PATH === undefined,
  },
  () => {
    let local: LocalChain;
    let usdc: Address;
    let mcp: Connected;
    const signer = privateKeyToAccount(generatePrivateKey());

    before(async () => {
      local = await startChain("ethereum");
      usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
      await local.deployer.sendTransaction({
        account: local.deployer.account!,
        chain: null,
        to: signer.address,
        value: 10n ** 18n,
      });
      mcp = await connect(endpointsFor({ [String(local.chain.id)]: local.rpcUrl }));
    });
    after(async () => {
      await mcp?.close();
      await local?.stop();
    });

    it("deploys the Pot and cooks on it, from the plan sauce_tx built", async () => {
      const plan = ok(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "ethereum",
          owner: signer.address,
          args: [RECIPIENT, AMOUNT.toString()],
        }),
      ) as { pot: Address; transactions: Unsigned[] };
      assert.equal(plan.transactions.length, 2);
      await local.mint(usdc, plan.pot, AMOUNT);
      const nonce = await local.publicClient.getTransactionCount({ address: signer.address });
      const fees = await local.publicClient.estimateFeesPerGas();
      const signed = await Promise.all(
        plan.transactions.map((tx, index) =>
          signer.signTransaction({
            chainId: 1,
            type: "eip1559",
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
            nonce: nonce + index,
            gas: 1_000_000n,
            maxFeePerGas: fees.maxFeePerGas * 2n,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          }),
        ),
      );

      const sent = ok(await mcp.call("sauce_send", { transactions: signed })) as {
        ok: boolean;
        chain: string;
        sent: Array<Record<string, unknown>>;
      };

      assert.equal(sent.ok, true);
      assert.equal(sent.chain, "ethereum");
      assert.deepEqual(
        sent.sent.map((each) => each.status),
        ["success", "success"],
      );
      assert.match(String(sent.sent[0]!.what), /deployPot/);
      assert.equal(sent.sent[1]!.what, `cook on Pot ${plan.pot}`);
      assert.ok(Array.isArray(sent.sent[1]!.moves));
      assert.equal(await local.balanceOf(usdc, RECIPIENT), AMOUNT);
      assert.ok(mcp.received.every((text) => !text.includes(local.rpcUrl)));
    });
  },
);

const SOLANA_URL = "http://127.0.0.1:65532/";
const SWEEP = [
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>, amount: Uint256): Uint256 {",
  "  transfer(MINT, tokenProgram, source, dest, authority, amount);",
  "  return amount;",
  "}",
  "",
].join("\n");

describe(
  "sauce_tx, signed elsewhere, sent by sauce_send: Solana",
  {
    skip: !svmArtifactsPresent,
  },
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let mcp: Connected;
    let owner: KeyPairSigner;
    let source: SvmAddress;
    let dest: SvmAddress;
    const mint = randomAddress();

    before(async () => {
      harness = await startEngine(
        1_700_000_000n,
        ENGINE_SO as string,
        address(v12SvmEngineProgramId()),
      );
      owner = await generateKeyPairSigner();
      harness.svm.airdrop(owner.address, lamports(5_000_000_000n));
      setMint(harness, mint, 6);
      const pot = (
        await derivePotPda(address(v12SvmKitchenProgramId()), owner.address, new Uint8Array(32))
      ).address;
      source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
      dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      shim = solanaShim(harness.svm, SOLANA_URL);
      shim.install();
      mcp = await connect();
    });
    after(async () => {
      shim?.restore();
      await mcp?.close();
    });

    it("lands the cook sauce_tx built, signed by the owner, and reads back what it returned", async () => {
      const built = ok(
        await mcp.call("sauce_tx", {
          source: SWEEP,
          chain: "solana",
          owner: owner.address,
          defines: { MINT: bytesToHex(new Uint8Array(getAddressCodec().encode(mint))) },
          accounts: { tokenProgram: TOKEN_PROGRAM, source, dest, authority: "pot" },
          args: ["400"],
          rpcUrl: SOLANA_URL,
        }),
      ) as { transaction: string; createsPot: boolean };
      assert.equal(built.createsPot, true);
      const signed = getBase64EncodedWireTransaction(
        await signTransaction(
          [owner.keyPair],
          getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction)),
        ),
      );

      const sent = ok(
        await mcp.call("sauce_send", { transactions: [signed], rpcUrl: SOLANA_URL }),
      ) as { ok: boolean; sent: Array<Record<string, unknown>> };

      assert.equal(sent.ok, true);
      assert.equal(sent.sent[0]!.status, "success");
      assert.equal(hexToBigInt(sent.sent[0]!.returns as Hex), 400n);
      assert.equal(tokenAmount(harness, dest), 400n);
      assert.deepEqual(Object.keys(shim.sent.at(-1)!.signatures), [owner.address]);
    });
  },
);

/** A program staged in a code buffer, naming more accounts than a transaction lists. */
const WIDE_ACCOUNTS = 40;
const WIDE = [
  `function main(${Array.from({ length: WIDE_ACCOUNTS }, (_, i) => `a${i}: Account`).join(", ")}): Uint256 {`,
  `  const blob = hex\`${"ab".repeat(1500)}\`;`,
  "  require(blob.length == 1500);",
  "  return 7;",
  "}",
  "",
].join("\n");

interface PlanStep {
  readonly step: string;
  readonly transactions?: ReadonlyArray<{ what: string; transaction: string }>;
  readonly cursor?: string;
}

describe(
  "a staged Solana cook as a plan, through the tools alone",
  { skip: !svmArtifactsPresent },
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let mcp: Connected;
    let wallets: Connected;
    let dir: string;
    let owner: KeyPairSigner;
    const accounts = Object.fromEntries(
      Array.from({ length: WIDE_ACCOUNTS }, (_, i) => [`a${i}`, randomAddress()]),
    );
    const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

    const sign = (step: PlanStep): Promise<string[]> =>
      Promise.all(
        (step.transactions ?? []).map(async ({ transaction }) =>
          getBase64EncodedWireTransaction(
            await signTransaction(
              [owner.keyPair],
              getTransactionDecoder().decode(getBase64Encoder().encode(transaction)),
            ),
          ),
        ),
      );

    before(async () => {
      harness = await startEngine(
        1_700_000_000n,
        ENGINE_SO as string,
        address(v12SvmEngineProgramId()),
      );
      owner = await generateKeyPairSigner();
      harness.svm.airdrop(owner.address, lamports(50_000_000_000n));
      // The bank cannot list its accounts: a scan looks through every account a sent
      // transaction names.
      shim = solanaShim(harness.svm, SOLANA_URL, () => [
        ...new Set(
          shim.sent.flatMap(
            (tx) =>
              (
                getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as {
                  staticAccounts: readonly SvmAddress[];
                }
              ).staticAccounts,
          ),
        ),
      ]);
      shim.install();
      mcp = await connect();
      dir = mkdtempSync(join(tmpdir(), "sauce-mcp-plan-"));
      wallets = await connect(undefined, undefined, {
        store: new WalletStore(join(dir, "wallets")),
        password: PASSWORD,
        source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
      });
    });
    after(async () => {
      shim?.restore();
      await mcp?.close();
      await wallets?.close();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    });

    it("signs each step sauce_tx and sauce_send return, to the end: setup, cook, close", async () => {
      const first = ok(
        await mcp.call("sauce_tx", {
          source: WIDE,
          chain: "solana",
          owner: owner.address,
          salt: "plan",
          accounts,
          rpcUrl: SOLANA_URL,
        }),
      ) as unknown as PlanStep;
      assert.equal(first.step, "setup");
      const steps: string[] = [];
      let step = first;
      let cookReturned: unknown;
      for (let round = 0; round < 6; round++) {
        const sent = ok(
          await mcp.call("sauce_send", {
            transactions: await sign(step),
            cursor: step.cursor,
            rpcUrl: SOLANA_URL,
          }),
        ) as { ok: boolean; sent: Array<Record<string, unknown>>; next: PlanStep };
        assert.equal(sent.ok, true, JSON.stringify(sent.sent));
        cookReturned ??= sent.sent.find((one) => one.returnType !== undefined)?.returned;
        steps.push(sent.next.step);
        if (sent.next.step === "done") break;
        step = sent.next;
      }
      assert.deepEqual(steps, ["cook", "close", "done"]);
      assert.equal(cookReturned, "7");
      // Only the owner ever signed.
      assert.ok(shim.sent.every((tx) => Object.keys(tx.signatures).join() === owner.address));
    });

    it("closes what a plan left open with sauce_reclaim and sauce_send", async () => {
      const setup = ok(
        await mcp.call("sauce_tx", {
          source: WIDE,
          chain: "solana",
          owner: owner.address,
          salt: "left-open",
          accounts,
          rpcUrl: SOLANA_URL,
        }),
      ) as unknown as PlanStep;
      ok(
        await mcp.call("sauce_send", {
          transactions: await sign(setup),
          cursor: setup.cursor,
          rpcUrl: SOLANA_URL,
        }),
      );
      // The cook is never sent: its buffer and table stay open.
      const found = ok(
        await mcp.call("sauce_reclaim", {
          chain: "solana",
          owner: owner.address,
          rpcUrl: SOLANA_URL,
        }),
      ) as {
        buffers: Array<{ codeBuffer: string }>;
        lookupTables: Array<{ address: string; state: string }>;
        transactions: Array<{ what: string; transaction: string }>;
      };
      assert.equal(found.buffers.length, 1);
      // This plan's table, and the one the plan before it kept for later cooks.
      assert.equal(found.lookupTables.length, 2);
      assert.ok(found.lookupTables.every((table) => table.state === "active"));
      const sent = ok(
        await mcp.call("sauce_send", {
          transactions: await sign(found as unknown as PlanStep),
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean };
      assert.equal(sent.ok, true);
      assert.equal(harness.svm.getAccount(address(found.buffers[0]!.codeBuffer)).exists, false);
      const after = ok(
        await mcp.call("sauce_reclaim", {
          chain: "solana",
          owner: owner.address,
          rpcUrl: SOLANA_URL,
        }),
      ) as { buffers: unknown[]; lookupTables: Array<{ state: string }> };
      assert.equal(after.buffers.length, 0);
      assert.ok(after.lookupTables.every((table) => table.state === "deactivating"));
    });

    it("sends the whole plan from a wallet with sauce_wallet_send, from sauce_tx's result", async () => {
      const created = ok(
        await wallets.call("sauce_wallet_create", { name: "sol", kind: "solana" }),
      );
      const wallet = address(String(created.address));
      harness.svm.airdrop(wallet, lamports(50_000_000_000n));
      const planned = ok(
        await wallets.call("sauce_tx", {
          source: WIDE,
          chain: "solana",
          owner: wallet,
          accounts,
          rpcUrl: SOLANA_URL,
        }),
      );
      const sent = ok(
        await wallets.call("sauce_wallet_send", {
          wallet: "sol",
          transaction: planned,
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean; sent: Array<{ what: string; status: string; returned?: unknown }> };
      assert.equal(sent.ok, true, JSON.stringify(sent));
      const whats = sent.sent.map((one) => one.what);
      assert.equal(whats[0], "creating the Pot");
      assert.ok(whats.includes("creating the lookup table"));
      assert.equal(whats.at(-1), "closing the code buffer");
      assert.equal(sent.sent.find((one) => one.what.startsWith("cook on Pot"))?.returned, "7");
      assert.ok(sent.sent.every((one) => one.status === "success"));
      assert.ok(wallets.received.every((text) => !text.includes(PASSWORD)));
    });

    it("sends the one cook sauce_tx handed out, from a wallet, as it was built", async () => {
      const created = ok(
        await wallets.call("sauce_wallet_create", { name: "sol-one", kind: "solana" }),
      );
      const wallet = address(String(created.address));
      harness.svm.airdrop(wallet, lamports(5_000_000_000n));
      const planned = ok(
        await wallets.call("sauce_tx", {
          source: "function main(): Uint256 {\n  return 5;\n}\n",
          chain: "solana",
          owner: wallet,
          rpcUrl: SOLANA_URL,
        }),
      ) as { transaction: string; cursor: string };
      const before = shim.sent.length;
      const sent = ok(
        await wallets.call("sauce_wallet_send", {
          wallet: "sol-one",
          transaction: planned,
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean; sent: Array<{ what: string; status: string; returned?: unknown }> };
      assert.equal(sent.ok, true, JSON.stringify(sent));
      assert.equal(sent.sent.length, 1);
      assert.equal(sent.sent[0]!.returned, "5");
      // The one handed out, and nothing besides: its message is the one sauce_tx built.
      assert.equal(shim.sent.length, before + 1);
      const handed = getTransactionDecoder().decode(getBase64Encoder().encode(planned.transaction));
      assert.deepEqual([...shim.sent.at(-1)!.messageBytes], [...handed.messageBytes]);
    });
  },
);
