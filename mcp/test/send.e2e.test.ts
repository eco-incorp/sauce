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
import { after, before, describe, it } from "node:test";

import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, hexToBigInt, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../sdk/dist/deployments/index.js";
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
    const evmSigner = async (gasOf: (index: number) => bigint): Promise<Sign> => {
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
          gas: gasOf(index),
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
      const planned = ok(await mcp.call("sauce_tx", program)) as { pot: Address };
      await local.mint(usdc, planned.pot, AMOUNT * 2n);

      // docs/examples/mcp-external-signer.ts, as a reader runs it.
      const sent = (await cookWithYourSigner(
        async (name, args) => ok(await mcp.call(name, args)),
        await evmSigner(() => 1_000_000n),
        program,
      )) as { ok: boolean; chain: string; sent: Array<Record<string, unknown>> };

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
      const sign = await evmSigner((index) => (index === 0 ? 21_000n : 30_000n));
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
  },
);
