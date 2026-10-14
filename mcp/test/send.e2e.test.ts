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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { decodeCursor, encodeCursor, isCook } from "../../sdk/dist/cli/svm-plan.js";
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
import {
  cookWithYourSigner,
  type Sign,
  type Unsigned,
} from "../../docs/examples/mcp-external-signer.js";
import { SEND_MOST, SIGNED_MOST } from "../src/send.js";
import { connect, endpointsFor, erred, failed, ok, type Connected } from "./harness.js";

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

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

    /** The external signer: signs each transaction sauce_tx built with consecutive nonces. */
    const evmSigner = async (gasOf: (tx: Unsigned, index: number) => bigint): Promise<Sign> => {
      const nonce = await local.publicClient.getTransactionCount({ address: signer.address });
      const fees = await local.publicClient.estimateFeesPerGas();

      return (tx, index) =>
        signer.signTransaction({
          chainId: 1,
          type: "eip1559",
          to: tx.to as Address,
          data: tx.data as Hex,
          value: BigInt(tx.value ?? "0"),
          nonce: nonce + index,
          gas: gasOf(tx, index),
          maxFeePerGas: fees.maxFeePerGas * 2n,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
    };
    const program = {
      source: PAY,
      chain: "ethereum",
      owner: signer.address,
      args: [RECIPIENT, AMOUNT.toString()],
    };

    it("deploys the Pot and cooks on it: the documented example, end to end", async () => {
      // Unfunded, the cook would revert after the deployment: no gas is suggested for it.
      const planned = ok(await mcp.call("sauce_tx", program)) as {
        pot: Address;
        transactions: Unsigned[];
        notes: string[];
      };
      assert.equal(planned.transactions[1]!.gas, undefined);
      assert.ok(planned.notes.some((note) => /The cook is given no gas/.test(note)));
      await local.mint(usdc, planned.pot, AMOUNT * 2n);

      // docs/examples/mcp-external-signer.ts, as a reader runs it, signing with the gas each
      // transaction comes with: the cook's estimated as if the deployment had landed.
      const signedWith: bigint[] = [];
      const sent = (await cookWithYourSigner(
        async (name, args) => ok(await mcp.call(name, args)),
        await evmSigner((tx) => {
          assert.ok(tx.gas !== undefined, `${tx.what} comes with its gas`);
          signedWith.push(BigInt(tx.gas));

          return BigInt(tx.gas);
        }),
        program,
      )) as { ok: boolean; chain: string; sent: Array<Record<string, unknown>> };
      assert.equal(signedWith.length, 2);
      // Each a limit a transaction can run in, past the 21000 any transaction costs.
      assert.ok(
        signedWith.every((gas) => gas > 21_000n),
        String(signedWith),
      );

      assert.equal(sent.ok, true);
      assert.equal(sent.chain, "ethereum");
      assert.deepEqual(
        sent.sent.map((each) => each.status),
        ["success", "success"],
      );
      assert.match(String(sent.sent[0]!.what), /deployPot/);
      assert.equal(sent.sent[1]!.what, `cook on Pot ${planned.pot}`);
      assert.ok(Array.isArray(sent.sent[1]!.moves));
      assert.equal(await local.balanceOf(usdc, RECIPIENT), AMOUNT);
      assert.ok(mcp.received.every((text) => !text.includes(local.rpcUrl)));
    });

    it("returns a send that stopped as an error result that still carries what was sent", async () => {
      // The Pot is there now: sauce_tx builds the cook alone. Signed short of gas, it is refused
      // after the transfer ahead of it lands.
      const built = ok(await mcp.call("sauce_tx", program)) as unknown as Unsigned;
      const sign = await evmSigner((_, index) => (index === 0 ? 21_000n : 30_000n));
      const transfer = await sign({ chainId: 1, to: RECIPIENT, data: "0x", value: "1" }, 0);
      const cook = await sign(built, 1);

      const stopped = erred(await mcp.call("sauce_send", { transactions: [transfer, cook] })) as {
        ok: boolean;
        sent: Array<{ status: string; reason?: string }>;
        notes: string[];
      };

      assert.equal(stopped.ok, false);
      assert.deepEqual(
        stopped.sent.map((each) => each.status),
        ["success", "failed"],
      );
      assert.match(stopped.sent[1]!.reason ?? "", /gas limit of 30000, and the simulation used/);
      assert.ok(
        stopped.notes.some((note) => /nothing after it was sent \(1 of 2 sent\)/.test(note)),
      );
    });
  },
);

describe("sauce_send's input, bounded", () => {
  let mcp: Connected;
  before(async () => {
    mcp = await connect();
  });
  after(async () => {
    await mcp?.close();
  });

  it("refuses more transactions than a call sends, and one longer than any signed one is", async () => {
    const one = Buffer.from([1, 2, 3]).toString("base64");
    assert.match(
      failed(
        await mcp.call("sauce_send", {
          transactions: Array.from({ length: SEND_MOST + 1 }, () => one),
          rpcUrl: "https://127.0.0.1:1/",
        }),
      ),
      /too_big|at most|Too big|32/i,
    );
    assert.match(
      failed(
        await mcp.call("sauce_send", {
          transactions: [`0x${"ab".repeat(SIGNED_MOST)}`],
          rpcUrl: "https://127.0.0.1:1/",
        }),
      ),
      /too_big|Too big|262146/i,
    );
  });
});

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
      // docs/examples/mcp-external-signer.ts, the signer here a Solana keypair.
      const sent = (await cookWithYourSigner(
        async (name, args) => ok(await mcp.call(name, args)),
        async (unsigned) =>
          getBase64EncodedWireTransaction(
            await signTransaction(
              [owner.keyPair],
              getTransactionDecoder().decode(getBase64Encoder().encode(unsigned.transaction!)),
            ),
          ),
        {
          source: SWEEP,
          chain: "solana",
          owner: owner.address,
          defines: { MINT: bytesToHex(new Uint8Array(getAddressCodec().encode(mint))) },
          accounts: { tokenProgram: TOKEN_PROGRAM, source, dest, authority: "pot" },
          args: ["400"],
          rpcUrl: SOLANA_URL,
        },
        SOLANA_URL,
      )) as { ok: boolean; sent: Array<Record<string, unknown>> };

      assert.equal(sent.ok, true);
      assert.equal(sent.sent[0]!.status, "success");
      assert.equal(hexToBigInt(sent.sent[0]!.returns as Hex), 400n);
      assert.equal(tokenAmount(harness, dest), 400n);
      assert.deepEqual(Object.keys(shim.sent.at(-1)!.signatures), [owner.address]);
    });

    it("builds no cook its simulation says would fail: an error saying why, nothing to sign", async () => {
      const result = erred(
        await mcp.call("sauce_tx", {
          source: SWEEP,
          chain: "solana",
          owner: owner.address,
          defines: { MINT: bytesToHex(new Uint8Array(getAddressCodec().encode(mint))) },
          accounts: { tokenProgram: TOKEN_PROGRAM, source, dest, authority: "pot" },
          args: ["5000"],
          rpcUrl: SOLANA_URL,
        }),
      ) as {
        transaction?: string;
        transactions: unknown[];
        fails: string;
        logs: string[];
        cursor: string;
      };
      assert.equal(result.transaction, undefined);
      assert.deepEqual(result.transactions, []);
      assert.ok(result.fails.length > 0);
      assert.ok(result.logs.length > 0);
      assert.equal(decodeCursor(result.cursor).cook, undefined);
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
    let walletAddress: SvmAddress;
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

    it("signs each step sauce_tx and sauce_send return, to the end: the documented example", async () => {
      // docs/examples/mcp-external-signer.ts, the signer a Solana keypair the server never sees.
      const done = (await cookWithYourSigner(
        async (name, args) => ok(await mcp.call(name, args)),
        async (unsigned) =>
          getBase64EncodedWireTransaction(
            await signTransaction(
              [owner.keyPair],
              getTransactionDecoder().decode(getBase64Encoder().encode(unsigned.transaction!)),
            ),
          ),
        {
          source: WIDE,
          chain: "solana",
          owner: owner.address,
          salt: "plan",
          accounts,
          rpcUrl: SOLANA_URL,
        },
        SOLANA_URL,
      )) as { ok: boolean; steps: string[]; sent: Array<Record<string, unknown>> };

      assert.equal(done.ok, true, JSON.stringify(done.sent));
      assert.deepEqual(done.steps, ["setup", "cook", "close"]);
      // What main returned, read on the cook alone: the Pot's creation names the engine, and runs
      // no program.
      assert.deepEqual(
        done.sent.filter((one) => one.returns !== undefined).map((one) => one.returned),
        ["7"],
      );
      assert.equal(done.sent.at(-1)!.what, "closing the code buffer");
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
      const { next: cook } = ok(
        await mcp.call("sauce_send", {
          transactions: await sign(setup),
          cursor: setup.cursor,
          rpcUrl: SOLANA_URL,
        }),
      ) as unknown as { next: PlanStep };
      type Use = { inUse?: boolean; freeFromSlot?: string; kept?: boolean };
      type Found = {
        buffers: Array<{ codeBuffer: string } & Use>;
        lookupTables: Array<{ address: string; state: string } & Use>;
        transactions: Array<{ what: string; transaction: string }>;
      };
      const reclaim = async (more: Record<string, unknown> = {}): Promise<Found> =>
        ok(
          await mcp.call("sauce_reclaim", {
            chain: "solana",
            owner: owner.address,
            rpcUrl: SOLANA_URL,
            ...more,
          }),
        ) as unknown as Found;
      // The cook the plan handed out can still land: its buffer and table are in use, and nothing
      // closes them.
      const inUse = await reclaim();
      assert.equal(inUse.buffers.length, 1);
      const buffer = inUse.buffers[0]!;
      assert.equal(buffer.inUse, true);
      const held = [buffer, ...inUse.lookupTables.filter((table) => table.inUse === true)];
      assert.ok(held.length >= 2);
      for (const one of held) {
        const at = "codeBuffer" in one ? one.codeBuffer : one.address;
        assert.ok(inUse.transactions.every((tx) => !tx.what.includes(at)));
      }
      // Past that, the plan given to keep keeps them.
      harness.svm.warpToSlot(
        held.map((one) => BigInt(one.freeFromSlot!)).reduce((a, b) => (b > a ? b : a)),
      );
      const kept = await reclaim({ keep: [cook.cursor] });
      assert.equal(kept.buffers[0]!.kept, true);
      assert.ok(kept.transactions.every((tx) => !tx.what.includes(buffer.codeBuffer)));
      // The cook is never sent: its buffer and table stay open until reclaimed.
      const found = await reclaim();
      assert.equal(found.buffers.length, 1);
      assert.equal(found.buffers[0]!.inUse, undefined);
      // This plan's table, and the one the plan before it kept for later cooks.
      assert.equal(found.lookupTables.length, 2);
      assert.ok(found.lookupTables.every((table) => table.state === "active"));
      // keepTables leaves the tables for later cooks: only the buffer's close.
      const buffersOnly = await reclaim({ keepTables: true });
      assert.deepEqual(
        buffersOnly.transactions.map((tx) => tx.what),
        [`closing code buffer ${found.buffers[0]!.codeBuffer}`],
      );
      const sent = ok(
        await mcp.call("sauce_send", {
          transactions: await sign(found as unknown as PlanStep),
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean };
      assert.equal(sent.ok, true);
      assert.equal(harness.svm.getAccount(address(found.buffers[0]!.codeBuffer)).exists, false);
      const after = await reclaim();
      assert.equal(after.buffers.length, 0);
      assert.ok(after.lookupTables.every((table) => table.state === "deactivating"));
    });

    it("sends the whole plan from a wallet with sauce_wallet_send, from sauce_tx's result", async () => {
      const created = ok(
        await wallets.call("sauce_wallet_create", { name: "sol", kind: "solana" }),
      );
      const wallet = address(String(created.address));
      walletAddress = wallet;
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

    it("holds a wallet's whole plan to its policy before sending any, and keeps the ledger whole", async () => {
      const planned = ok(
        await wallets.call("sauce_tx", {
          source: WIDE,
          chain: "solana",
          owner: walletAddress,
          salt: "policy",
          accounts,
          rpcUrl: SOLANA_URL,
        }),
      );
      const policy = join(dir, "wallets", "sol.policy.json");
      const ledger = join(dir, "wallets", "sol.ledger.jsonl");
      const lines = (): Array<{ id: string; state: string }> =>
        existsSync(ledger)
          ? readFileSync(ledger, "utf8")
              .trim()
              .split("\n")
              .filter((line) => line !== "")
              .map((line) => JSON.parse(line) as { id: string; state: string })
          : [];
      // A day's native limit below the rent the plan's setup takes: refused before anything goes.
      writeFileSync(policy, JSON.stringify({ native: { perDay: "0.01" } }), { mode: 0o600 });
      const count = shim.sent.length;
      const before = lines().length;
      assert.match(
        failed(
          await wallets.call("sauce_wallet_send", {
            wallet: "sol",
            transaction: planned,
            rpcUrl: SOLANA_URL,
          }),
        ),
        /native\.perDay is 0\.01 SOL/,
      );
      assert.equal(shim.sent.length, count);
      assert.equal(lines().length, before);

      // Room for it: every transaction reserved in the ledger, then sent.
      writeFileSync(policy, JSON.stringify({ native: { perDay: "5" } }), { mode: 0o600 });
      const sent = ok(
        await wallets.call("sauce_wallet_send", {
          wallet: "sol",
          transaction: planned,
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean; sent: Array<{ status: string }> };
      assert.equal(sent.ok, true, JSON.stringify(sent));
      const written = lines().slice(before);
      const reserved = written.filter((line) => line.state === "reserved").map((line) => line.id);
      const closed = written.filter((line) => line.state === "sent").map((line) => line.id);
      assert.equal(reserved.length, sent.sent.length);
      assert.deepEqual([...closed].sort(), [...reserved].sort());
      rmSync(policy);
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

    it("keeps the cook a wallet sent and could not confirm, and learns it landed rather than send it again", async () => {
      const created = ok(
        await wallets.call("sauce_wallet_create", { name: "sol-lost", kind: "solana" }),
      );
      const wallet = address(String(created.address));
      harness.svm.airdrop(wallet, lamports(5_000_000_000n));
      const planned = ok(
        await wallets.call("sauce_tx", {
          source: "function main(): Uint256 {\n  return 8;\n}\n",
          chain: "solana",
          owner: wallet,
          rpcUrl: SOLANA_URL,
        }),
      ) as { cursor: string };
      // The plan with its cook not handed out yet: the wallet builds and sends it.
      const { cook: _, ...unsent } = decodeCursor(planned.cursor);
      // Once the cook goes out, the endpoint stops answering for its status.
      const shimmed = globalThis.fetch;
      let cookSent = false;
      globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
        if (String(input) === SOLANA_URL && init?.body !== undefined) {
          const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
          if (method === "sendTransaction") {
            cookSent ||= isCook(
              getTransactionDecoder().decode(getBase64Encoder().encode(String(params[0]))),
            );
          } else if (method === "getSignatureStatuses" && cookSent) {
            return Response.json({
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32603, message: "the node lost track" },
            });
          }
        }

        return shimmed(input as string, init as RequestInit);
      }) as typeof fetch;
      let lost: {
        ok: boolean;
        sent: Array<{ what: string; status: string }>;
        cursor: string;
        notes: string[];
      };
      try {
        lost = ok(
          await wallets.call("sauce_wallet_send", {
            wallet: "sol-lost",
            transaction: { cursor: encodeCursor(unsent) },
            rpcUrl: SOLANA_URL,
          }),
        ) as typeof lost;
      } finally {
        globalThis.fetch = shimmed;
      }
      assert.equal(cookSent, true);
      assert.equal(lost.ok, false);
      assert.ok(
        lost.notes.some((note) =>
          note.startsWith("the cook went out, and how it went is not known"),
        ),
        JSON.stringify(lost.notes),
      );
      // The cursor survives, remembering the cook as handed out.
      const kept = decodeCursor(lost.cursor);
      assert.notEqual(kept.cook, undefined);
      assert.equal(kept.cooked, undefined);

      // Past its blockhash, the next call finds it in the owner's transactions: nothing is sent.
      harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
      const before = shim.sent.length;
      const learned = ok(
        await wallets.call("sauce_wallet_send", {
          wallet: "sol-lost",
          transaction: { cursor: lost.cursor },
          rpcUrl: SOLANA_URL,
        }),
      ) as { ok: boolean; sent: unknown[]; cursor?: string };
      assert.equal(learned.ok, true, JSON.stringify(learned));
      assert.deepEqual(learned.sent, []);
      assert.equal(learned.cursor, undefined);
      assert.equal(shim.sent.length, before);
    });

    it("sends a fresh cook from a wallet once the one sauce_tx handed out expired unsent", async () => {
      const created = ok(
        await wallets.call("sauce_wallet_create", { name: "sol-late", kind: "solana" }),
      );
      const wallet = address(String(created.address));
      harness.svm.airdrop(wallet, lamports(5_000_000_000n));
      const planned = ok(
        await wallets.call("sauce_tx", {
          source: "function main(): Uint256 {\n  return 6;\n}\n",
          chain: "solana",
          owner: wallet,
          rpcUrl: SOLANA_URL,
        }),
      ) as { transaction: string; cursor: string };
      // Held past its blockhash: sent as it was built, the cluster refuses it.
      harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
      const before = shim.sent.length;
      const sent = ok(
        await wallets.call("sauce_wallet_send", {
          wallet: "sol-late",
          transaction: planned,
          rpcUrl: SOLANA_URL,
        }),
      ) as {
        ok: boolean;
        sent: Array<{ what: string; status: string; returned?: unknown }>;
        notes: string[];
      };
      assert.equal(sent.ok, true, JSON.stringify(sent));
      assert.ok(
        sent.notes.some((note) => note.startsWith("the cook, as handed out, was not sent: ")),
        JSON.stringify(sent.notes),
      );
      // The owner's transactions show it never landed: one fresh cook went out, and only one.
      assert.equal(shim.sent.length, before + 1);
      assert.equal(sent.sent.length, 1);
      assert.equal(sent.sent[0]!.returned, "6");
      const handed = getTransactionDecoder().decode(getBase64Encoder().encode(planned.transaction));
      assert.notDeepEqual([...shim.sent.at(-1)!.messageBytes], [...handed.messageBytes]);
    });
  },
);
