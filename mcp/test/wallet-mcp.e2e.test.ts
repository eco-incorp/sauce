/**
 * What Sauce's tools return, handed as it is to a wallet's own MCP server and sent by it: mocks of
 * Phantom's (`wallet-mcp/phantom.ts`) and Coinbase's (`wallet-mcp/coinbase.ts`), each taking its
 * input through that wallet's own schema and signing with a throwaway key on a local chain — an
 * anvil running the released gated stack (`sdk/test/cli-anvil.ts`), and LiteSVM running the
 * released Kitchen and engine behind `sdk/test/svm/rpc-shim.ts`. The agent here is the test: it
 * calls a Sauce tool, passes the field the skills name to the wallet's tool, and reads the chain.
 *
 * GATED like every execution suite: the EVM half on SAUCE_V12_RUNTIME_CREATION_HEX, the Solana half
 * on the engine and Kitchen artifacts.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  lamports,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, getAddress, type Address, type Hex } from "viem";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../sdk/dist/deployments/index.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { derivePotPda } from "../../sdk/dist/svm/index.js";
import {
  fixture,
  potOwner,
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
import { coinbaseMock, type CoinbaseMock } from "./wallet-mcp/coinbase.js";
import { phantomMock, type PhantomMock } from "./wallet-mcp/phantom.js";

const EVM_FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../sdk/test/evm/fixtures",
);
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const ZERO_SALT = `0x${"00".repeat(32)}` as Hex;
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

/** A wallet tool's result, as the agent reads it; its error text when it refused. */
const result = (out: CallToolResult): Record<string, unknown> => {
  assert.notEqual(out.isError, true, JSON.stringify(out.content));

  return out.structuredContent as Record<string, unknown>;
};
const refusal = (out: CallToolResult): string => {
  assert.equal(out.isError, true, "the wallet refused it");

  return (out.content as Array<{ text: string }>).map((part) => part.text).join("\n");
};

interface Tx extends Record<string, unknown> {
  readonly what: string;
  readonly to: Address;
  readonly data: Hex;
  readonly value: Hex;
}

describe(
  "a wallet's own MCP server sends what Sauce builds: EVM",
  { skip: RUNTIME_HEX_PATH === undefined },
  () => {
    let base: LocalChain;
    let usdc: Address;
    let sauce: Connected;
    let phantom: PhantomMock;
    let coinbase: CoinbaseMock;

    before(async () => {
      base = await startChain("base");
      usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
      sauce = await connect(endpointsFor({ [String(base.chain.id)]: base.rpcUrl }));
      phantom = await phantomMock({ evm: { [base.chain.id]: base.rpcUrl } });
      await base.testClient.setBalance({ address: phantom.evmAddress, value: 10n ** 18n });
      coinbase = await coinbaseMock({
        rpcUrl: base.rpcUrl,
        chainId: base.chain.id,
        creationCode: fixture("BatchWallet", EVM_FIXTURES),
        setBalance: (address, value) => base.testClient.setBalance({ address, value }),
      });
    });

    after(async () => {
      await coinbase?.close();
      await phantom?.close();
      await sauce?.close();
      await base?.stop();
    });

    it("Phantom's evm_send takes each transaction of sauce_tx's plan as it is: the Pot, then the cook", async () => {
      const owner = phantom.evmAddress;
      const pot = getAddress(v12PredictPot(owner, ZERO_SALT) as Address);
      await base.mint(usdc, pot, 1_500_000n);
      const plan = ok(
        await sauce.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner,
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as { transactions: Tx[] };
      assert.equal(plan.transactions.length, 2, "the Pot's deployment, then the cook");

      for (const tx of plan.transactions) {
        // First the preview Phantom shows the user, then the send once they agree.
        const preview = result(await phantom.call("evm_send", tx));
        assert.equal(preview.status, "pending_confirmation", tx.what);
        const sent = result(await phantom.call("evm_send", { ...tx, confirmed: true }));
        assert.equal(sent.from, owner);
        assert.equal(sent.networkId, `eip155:${base.chain.id}`);
        const receipt = await base.publicClient.waitForTransactionReceipt({
          hash: sent.hash as Hex,
        });
        assert.equal(receipt.status, "success", tx.what);
      }
      assert.equal(getAddress(await potOwner(base, pot)), owner, "the agent wallet owns the Pot");
      assert.equal(await base.balanceOf(usdc, RECIPIENT), 1_500_000n, "and the cook ran");
    });

    it("evm_send refuses what Phantom refuses: a decimal value, an unsent chain", async () => {
      const tx = ok(
        await sauce.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner: phantom.evmAddress,
          args: [RECIPIENT, "0"],
        }),
      ) as unknown as Tx;
      // The chain id as Phantom reads it in each spelling: a number (Sauce's), decimal or hex.
      for (const chainId of [base.chain.id, String(base.chain.id), "0x2105"]) {
        assert.equal(
          result(await phantom.call("evm_send", { ...tx, chainId })).status,
          "pending_confirmation",
        );
      }
      assert.match(
        refusal(await phantom.call("evm_send", { ...tx, value: BigInt(tx.value).toString() })),
        /0x-prefixed hex string/,
      );
      assert.match(
        refusal(await phantom.call("evm_send", { ...tx, chainId: 42161 })),
        /Arbitrum One \(eip155:42161\) is not supported/,
      );
    });

    it("Coinbase's send_calls runs the Pot's deployment, --fund's transfer and the cook as one approval", async () => {
      const wallets = result(await coinbase.call("get_wallets", {})) as {
        wallets: Array<{ address: Address }>;
      };
      const owner = wallets.wallets[0]!.address;
      assert.equal(owner, coinbase.wallet);
      const pot = getAddress(v12PredictPot(owner, ZERO_SALT) as Address);
      await base.mint(usdc, owner, 1_500_000n);
      const before = await base.balanceOf(usdc, RECIPIENT);
      const plan = ok(
        await sauce.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner,
          fund: ["USDC:1.5"],
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as { transactions: Tx[]; sendCalls: Record<string, unknown> };
      assert.deepEqual(
        plan.transactions.map((tx) => tx.what.split(" ")[0]),
        [`Kitchen.deployPot(${owner},`, "transfer", "cook"],
      );

      const asked = result(await coinbase.call("send_calls", plan.sendCalls));
      const requestId = asked.requestId as string;
      assert.match(String(asked.approvalUrl), /approve/);
      assert.equal(
        result(await coinbase.call("get_request_status", { requestId })).status,
        "pending",
        "nothing runs before the user approves",
      );
      assert.equal(await base.publicClient.getCode({ address: pot }), undefined);

      await coinbase.approve(requestId);
      assert.equal(
        result(await coinbase.call("get_request_status", { requestId })).status,
        "confirmed",
      );
      assert.equal(getAddress(await potOwner(base, pot)), owner, "the smart wallet owns the Pot");
      assert.equal((await base.balanceOf(usdc, RECIPIENT)) - before, 1_500_000n);
      assert.equal(
        await base.balanceOf(usdc, owner),
        0n,
        "its USDC went in, and out through the cook",
      );
    });

    it("a batch with a call that fails reverts every call: no Pot, nothing moved", async () => {
      const owner = coinbase.wallet;
      // Another Pot of the same wallet's, and less USDC than the transfer moves.
      const pot = getAddress(v12PredictPot(owner, `0x${"00".repeat(31)}02`) as Address);
      await base.mint(usdc, owner, 1_000_000n);
      const plan = ok(
        await sauce.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner,
          saltHex: `0x${"00".repeat(31)}02`,
          fund: ["USDC:1.5"],
          args: [RECIPIENT, "1500000"],
        }),
      ) as unknown as { sendCalls: Record<string, unknown>; notes: string[] };
      assert.ok(
        plan.notes.some((note) => /below the 1500000/.test(note)),
        `the plan said so: ${plan.notes.join(" | ")}`,
      );

      const { requestId } = result(await coinbase.call("send_calls", plan.sendCalls)) as {
        requestId: string;
      };
      await coinbase.approve(requestId);
      assert.equal(
        result(await coinbase.call("get_request_status", { requestId })).status,
        "failed",
      );
      assert.equal(await base.publicClient.getCode({ address: pot }), undefined, "no Pot");
      assert.equal(await base.balanceOf(usdc, owner), 1_000_000n, "the wallet's USDC untouched");
    });

    it("send_calls refuses what its documented shape does not take", async () => {
      const plan = ok(
        await sauce.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner: coinbase.wallet,
          args: [RECIPIENT, "0"],
        }),
      ) as unknown as { sendCalls: { chain: string; calls: Array<Record<string, unknown>> } };
      const [call] = plan.sendCalls.calls;
      const send = (calls: unknown[], chain = plan.sendCalls.chain) =>
        coinbase.call("send_calls", { chain, calls });
      // A transaction of Sauce's whole, with its labels, is not a call; a decimal value is not one.
      assert.match(refusal(await send([{ ...call, what: "cook" }])), /unrecognized|Unrecognized/);
      assert.match(refusal(await send([{ ...call, value: "1234" }])), /hex ETH in wei/);
      assert.match(refusal(await send([call], "base-sepolia")), /not the chain this wallet is on/);
    });
  },
);

const SOLANA_URL = "http://127.0.0.1:65531/";
const SWEEP = [
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>, amount: Uint256): Uint256 {",
  "  transfer(MINT, tokenProgram, source, dest, authority, amount);",
  "  return amount;",
  "}",
  "",
].join("\n");

describe(
  "a wallet's own MCP server sends what Sauce builds: Solana",
  { skip: !svmArtifactsPresent },
  () => {
    let harness: EngineHarness;
    let shim: SolanaShim;
    let sauce: Connected;
    let wallet: KeyPairSigner;
    let phantom: PhantomMock;
    let rewriting: PhantomMock;
    let source: SvmAddress;
    let dest: SvmAddress;
    const mint = randomAddress();

    before(async () => {
      harness = await startEngine(
        1_700_000_000n,
        ENGINE_SO as string,
        address(v12SvmEngineProgramId()),
      );
      wallet = await generateKeyPairSigner();
      harness.svm.airdrop(wallet.address, lamports(5_000_000_000n));
      setMint(harness, mint, 6);
      const pot = (
        await derivePotPda(address(v12SvmKitchenProgramId()), wallet.address, new Uint8Array(32))
      ).address;
      source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
      dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
      shim = solanaShim(harness.svm, SOLANA_URL);
      shim.install();
      sauce = await connect();
      // One agent wallet, behind a signer that signs as given and one that rebuilds first.
      phantom = await phantomMock({ solana: SOLANA_URL, solanaKey: wallet });
      rewriting = await phantomMock({ solana: SOLANA_URL, solanaKey: wallet, prepare: "rewrite" });
    });

    after(async () => {
      await rewriting?.close();
      await phantom?.close();
      await sauce?.close();
      shim?.restore();
    });

    const cook = async (amount: string) =>
      ok(
        await sauce.call("sauce_tx", {
          source: SWEEP,
          chain: "solana",
          owner: wallet.address,
          defines: { MINT: bytesToHex(new Uint8Array(getAddressCodec().encode(mint))) },
          accounts: { tokenProgram: TOKEN_PROGRAM, source, dest, authority: "pot" },
          args: [amount],
          rpcUrl: SOLANA_URL,
        }),
      ) as { transaction: string; feePayer: string };

    it("Phantom's solana_send signs the cook sauce_tx built, as its fee payer, and it lands", async () => {
      const built = await cook("400");
      assert.equal(built.feePayer, wallet.address);
      const preview = result(await phantom.call("solana_send", { transaction: built.transaction }));
      assert.equal(preview.status, "pending_confirmation");
      assert.deepEqual((preview.simulation as { warnings: unknown[] }).warnings, []);
      const sent = result(
        await phantom.call("solana_send", { transaction: built.transaction, confirmed: true }),
      );
      assert.equal(sent.account, wallet.address);
      assert.equal(
        sent.networkId,
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        "mainnet, by default",
      );
      assert.equal(tokenAmount(harness, dest), 400n);
    });

    it("a signer that rebuilds the cook first lands it too: no one but the fee payer signed it", async () => {
      const built = await cook("100");
      result(
        await rewriting.call("solana_send", { transaction: built.transaction, confirmed: true }),
      );
      assert.equal(tokenAmount(harness, dest), 500n);
    });
  },
);
