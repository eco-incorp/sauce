/**
 * A mock of Phantom's MCP server (`@phantom/mcp-server`), for tests that hand it what Sauce's tools
 * return: its two send tools, registered under the names its server lists them by, `evm_send` and
 * `solana_send`, each taking its input through Phantom's own schema (`phantom.verbatim.ts`), so a
 * field Phantom refuses is refused here and one it does not declare is dropped. Behind them, a
 * throwaway key of its own in place of Phantom's KMS, signing as the KMS does and sending to a local
 * chain: an anvil for `evm_send` (nonce, gas with 20% room and a legacy gas price filled in where
 * the call leaves them out, as Phantom does), a LiteSVM bank behind `sdk/test/svm/rpc-shim.ts` for
 * `solana_send`. Without `confirmed` each returns the preview Phantom returns, a simulation, and
 * sends nothing.
 *
 * `prepare` is what happens to a Solana transaction before it is signed. Phantom's client hands it
 * to a server-side preparation step for user wallets, which the package does not show:
 * `pass-through` signs it as given; `rewrite` gives it a fresh blockhash first and signs that, as a
 * hosted signer refreshing a stale transaction may — and every signature it already carried, made
 * over the old message, is gone.
 *
 * Nothing here reaches a live chain: every endpoint is the test's own.
 */
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  address,
  createSolanaRpc,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  partiallySignTransaction,
  verifySignature,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  assertTransactionNetworkSupported,
  normalizeNetworkId,
  parseChainId,
  SendEvmTransactionSchema,
  SendSolanaTransactionSchema,
} from "./phantom.verbatim.js";

export type Prepare = "pass-through" | "rewrite";

export interface PhantomOptions {
  /** The EVM chains it sends on: an endpoint for each chain id. */
  readonly evm?: Readonly<Record<number, string>>;
  /** The Solana cluster it sends on. */
  readonly solana?: string;
  /** What happens to a Solana transaction before it is signed (default `pass-through`). */
  readonly prepare?: Prepare;
  /** The wallet's Solana key, to share one between two mocks; else a fresh one. */
  readonly solanaKey?: KeyPairSigner;
}

export interface PhantomMock {
  /** The agent wallet's EVM address: what Sauce builds for, as the Pot's owner or `from`. */
  readonly evmAddress: Address;
  /** The agent wallet's Solana key. */
  readonly solanaKey: KeyPairSigner;
  /** Calls one of its tools, as an agent's client does. */
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** A tool's structured result, as a client reads it. */
const answer = (value: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

/** `transaction` with a fresh blockhash and no signature: what a signer that rebuilds it signs. */
async function rebuilt(
  rpc: ReturnType<typeof createSolanaRpc>,
  transaction: Transaction,
): Promise<Transaction> {
  const { value } = await rpc.getLatestBlockhash().send();
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const messageBytes = getCompiledTransactionMessageEncoder().encode({
    ...message,
    lifetimeToken: value.blockhash,
  });

  return {
    messageBytes,
    signatures: Object.fromEntries(Object.keys(transaction.signatures).map((key) => [key, null])),
  } as unknown as Transaction;
}

export async function phantomMock(options: PhantomOptions): Promise<PhantomMock> {
  const account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
  const solanaKey = options.solanaKey ?? (await generateKeyPairSigner());
  const prepare = options.prepare ?? "pass-through";
  const server = new McpServer({ name: "phantom-mock", version: "0.0.0" });

  server.registerTool(
    "evm_send",
    { description: "Phantom's evm_send, mocked", inputSchema: SendEvmTransactionSchema.shape },
    async (params) => {
      const chainId = parseChainId(params.chainId);
      const networkId = `eip155:${chainId}`;
      assertTransactionNetworkSupported(networkId);
      const url = options.evm?.[chainId];
      if (url === undefined) throw new Error(`Unsupported chainId: ${chainId}.`);
      const client = createPublicClient({ transport: http(url) });
      const from = account.address;
      const { to, value, data } = params;
      if (params.confirmed !== true) {
        // The preview: a simulation from the wallet, nothing sent.
        try {
          await client.call({
            account: from,
            ...(to === undefined ? {} : { to }),
            value: BigInt(value),
            ...(data === undefined ? {} : { data: data as Hex }),
          });

          return answer({
            status: "pending_confirmation",
            simulation: { expectedChanges: [], warnings: [] },
          });
        } catch (error) {
          return answer({
            status: "pending_confirmation",
            simulation: {
              expectedChanges: [],
              warnings: [{ message: (error as Error).message.split("\n")[0] }],
            },
          });
        }
      }
      const nonce =
        params.nonce === undefined
          ? await client.getTransactionCount({ address: from, blockTag: "pending" })
          : Number(BigInt(params.nonce));
      const gasGiven = params.gas ?? params.gasLimit;
      const gas =
        gasGiven === undefined
          ? ((await client.estimateGas({
              account: from,
              ...(to === undefined ? {} : { to }),
              value: BigInt(value),
              ...(data === undefined ? {} : { data: data as Hex }),
            })) *
              120n) /
            100n
          : BigInt(gasGiven);
      const eip1559 = params.maxFeePerGas !== undefined;
      const signed = await account.signTransaction({
        chainId,
        nonce,
        gas,
        ...(to === undefined ? {} : { to }),
        value: BigInt(value),
        ...(data === undefined ? {} : { data: data as Hex }),
        ...(eip1559
          ? {
              type: "eip1559" as const,
              maxFeePerGas: BigInt(params.maxFeePerGas!),
              maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas ?? "0x0"),
            }
          : {
              type: "legacy" as const,
              gasPrice: BigInt(params.gasPrice ?? (await client.getGasPrice())),
            }),
      });
      const hash = await client.sendRawTransaction({ serializedTransaction: signed });

      return answer({ hash, networkId, from, to: to ?? null });
    },
  );

  server.registerTool(
    "solana_send",
    {
      description: "Phantom's solana_send, mocked",
      inputSchema: SendSolanaTransactionSchema.shape,
    },
    async (params) => {
      const networkId = normalizeNetworkId(params.networkId);
      if (!networkId.startsWith("solana:")) {
        throw new Error("send_solana_transaction supports Solana networks only");
      }
      if (options.solana === undefined) throw new Error("this mock has no Solana cluster");
      const rpc = createSolanaRpc(options.solana);
      const bytes = getBase64Encoder().encode(params.transaction);
      if (bytes.length === 0) throw new Error("transaction decoded to empty bytes");
      const given = getTransactionDecoder().decode(bytes);
      if (params.confirmed !== true) {
        const simulated = await rpc
          .simulateTransaction(params.transaction as never, {
            encoding: "base64",
            sigVerify: false,
          })
          .send();

        return answer({
          status: "pending_confirmation",
          simulation: {
            expectedChanges: [],
            warnings:
              simulated.value.err === null
                ? []
                : [{ message: `the transaction fails: ${JSON.stringify(simulated.value.err)}` }],
          },
        });
      }
      const transaction = prepare === "rewrite" ? await rebuilt(rpc, given) : given;
      let signature: string;
      try {
        const signed = await partiallySignTransaction([solanaKey.keyPair], transaction);
        signature = await rpc
          .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" })
          .send();
      } catch (error) {
        throw new Error(
          `Failed to send Solana transaction: ${(error as Error).message.split("\n")[0]}`,
          { cause: error },
        );
      }

      return answer({ signature, networkId, account: solanaKey.address });
    },
  );

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    evmAddress: account.address,
    solanaKey,
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Holds `transaction` to what Phantom's `solana_send` signs: standard base64 its schema
 * takes, a message whose first account, the fee payer, is `feePayer` and is the one signature
 * missing (all zero: the KMS adds it), and every other signer's signature there and valid over the
 * message — the fresh keys a transaction creates accounts with sign before it is handed out.
 * Returns the message's version and how many signed already.
 */
export async function signableBy(
  transaction: string,
  feePayer: string,
): Promise<{ readonly version: number | "legacy"; readonly presigned: number }> {
  SendSolanaTransactionSchema.parse({ transaction });
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(transaction));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  assert.equal(message.staticAccounts[0], feePayer, "the fee payer is the first account");
  const signatures = Object.entries(decoded.signatures);
  assert.equal(signatures.length, message.header.numSignerAccounts);
  assert.equal(signatures[0]![0], feePayer);
  assert.ok(
    signatures[0]![1] === null || signatures[0]![1].every((byte) => byte === 0),
    "the fee payer's signature is left empty",
  );
  for (const [signer, signature] of signatures.slice(1)) {
    assert.ok(signature !== null && signature.some((byte) => byte !== 0), `${signer} signed`);
    assert.ok(
      await verifySignature(
        await getPublicKeyFromAddress(address(signer)),
        signature,
        decoded.messageBytes,
      ),
      `${signer}'s signature is over this message`,
    );
  }

  return { version: message.version, presigned: signatures.length - 1 };
}
