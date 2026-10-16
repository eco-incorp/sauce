/**
 * A mock of Coinbase's Wallet MCP server (`https://wallet-mcp.coinbase.com`), for tests that hand it
 * what Sauce's tools return: `get_wallets`, `send_calls` and `get_request_status`, behind a smart
 * wallet on a local anvil — a contract wallet with Coinbase Smart Wallet's
 * `executeBatch((address,uint256,bytes)[])` (`sdk/test/evm/fixtures/BatchWallet.sol`), whose owner
 * key is a throwaway of the mock's. `send_calls` returns an approval link and a request id, and
 * runs nothing until the test approves, as the user does in Coinbase Wallet; the batch then runs as
 * one transaction, every call or none (EIP-5792's atomic batch), and `get_request_status` says how
 * it went.
 *
 * Coinbase publishes no package for this server and its tool list needs a signed-in session, so
 * `send_calls`' input is its own documentation's, quoted here verbatim from the `wallet-mcp` skill
 * in base/skills at ef8bcd52ccc2e79de846cdf8d16b6fc62cf459a4, `references/batch-calls.md`:
 *
 *   ## Shape
 *
 *   The MCP advertises the exact parameter names and types — defer to its tool description. The
 *   general shape is:
 *
 *   - A `chain` string (`base` by default, or `ethereum`, `arbitrum`, `optimism`, `polygon`, `bsc`,
 *     `avalanche`, `robinhood-chain`, or the `base-sepolia` testnet).
 *   - A `calls` array of `{ to, value, data }` objects:
 *     - `to` — target address, `0x`-prefixed (required)
 *     - `value` — hex ETH in wei (e.g. `0x0`), optional
 *     - `data` — calldata hex, optional
 *
 *   ## Approval flow
 *
 *   Same as any write tool: the response returns an approval URL and request ID.
 *
 * and `references/approval-mode.md`: "the response includes: an approval URL (… typically
 * `approvalUrl`) [and] a request ID (typically `requestId`)", then "Call the status-poll tool
 * (typically `get_request_status`) with the request ID". The schema below holds that shape
 * strictly: a field the documentation does not name is refused, so what passes here is what the
 * strictest reading of Coinbase's tool takes. The quoted text is base/skills', under the MIT
 * License, reproduced here as it asks:
 *
 *   MIT License
 *
 *   Copyright (c) 2026 Base
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * Nothing here reaches a live chain: the endpoint is the test's own anvil.
 */
import { randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as z from "zod";

/** The chain names `send_calls` takes (batch-calls.md). */
export const SEND_CALLS_CHAINS = [
  "base",
  "ethereum",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
  "avalanche",
  "robinhood-chain",
  "base-sepolia",
] as const;

/** The chain id each of those names, where this mock runs one. */
const CHAIN_IDS: Readonly<Partial<Record<(typeof SEND_CALLS_CHAINS)[number], number>>> = {
  base: 8453,
  ethereum: 1,
};

/** `send_calls`' input, as `references/batch-calls.md` documents it, held strictly. */
export const SendCallsSchema = z
  .object({
    chain: z.enum(SEND_CALLS_CHAINS).default("base"),
    calls: z
      .array(
        z
          .object({
            to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 0x-prefixed address"),
            value: z
              .string()
              .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/, "hex ETH in wei (e.g. 0x0)")
              .optional(),
            data: z
              .string()
              .regex(/^0x(?:[0-9a-fA-F]{2})*$/, "calldata hex")
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const WALLET = parseAbi([
  "function executeBatch((address target, uint256 value, bytes data)[] calls) payable",
]);

export interface CoinbaseOptions {
  /** The anvil the smart wallet lives on, and its chain id. */
  readonly rpcUrl: string;
  readonly chainId: number;
  /** `BatchWallet`'s creation code (`sdk/test/evm/fixtures/BatchWallet.json`). */
  readonly creationCode: Hex;
  /** Gives an account native currency: the test's anvil cheat. */
  readonly setBalance: (address: Address, wei: bigint) => Promise<void>;
}

export interface CoinbaseMock {
  /** The smart wallet: the address Sauce builds for, as the Pot's owner. */
  readonly wallet: Address;
  /** Calls one of its tools, as an agent's client does. */
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  /** What the user does in Coinbase Wallet: approves request `id`, which then runs. */
  approve(id: string): Promise<void>;
  close(): Promise<void>;
}

interface Request {
  readonly calls: ReadonlyArray<{ to: Address; value?: string; data?: string }>;
  status: "pending" | "confirmed" | "failed";
  transactionHash?: Hex;
}

const answer = (value: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

export async function coinbaseMock(options: CoinbaseOptions): Promise<CoinbaseMock> {
  const owner = privateKeyToAccount(generatePrivateKey());
  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const signer = createWalletClient({ account: owner, transport });
  await options.setBalance(owner.address, 10n ** 18n);
  const deployed = await signer.sendTransaction({
    account: owner,
    chain: null,
    data: `${options.creationCode}${encodeAbiParameters([{ type: "address" }], [owner.address]).slice(2)}`,
  });
  const wallet = getAddress(
    (await publicClient.waitForTransactionReceipt({ hash: deployed })).contractAddress!,
  );
  await options.setBalance(wallet, 10n ** 18n);

  const requests = new Map<string, Request>();
  const server = new McpServer({ name: "coinbase-wallet-mock", version: "0.0.0" });

  server.registerTool(
    "get_wallets",
    { description: "Coinbase Wallet MCP's get_wallets, mocked" },
    () =>
      answer({
        wallets: [{ address: wallet, type: "smart-wallet", chains: SEND_CALLS_CHAINS }],
      }),
  );

  server.registerTool(
    "send_calls",
    { description: "Coinbase Wallet MCP's send_calls, mocked", inputSchema: SendCallsSchema },
    (params) => {
      if (CHAIN_IDS[params.chain] !== options.chainId) {
        throw new Error(`${params.chain} is not the chain this wallet is on`);
      }
      const id = randomBytes(8).toString("hex");
      requests.set(id, { calls: params.calls as Request["calls"], status: "pending" });

      return answer({ approvalUrl: `mock-wallet://approve/${id}`, requestId: id });
    },
  );

  server.registerTool(
    "get_request_status",
    {
      description: "Coinbase Wallet MCP's get_request_status, mocked",
      inputSchema: { requestId: z.string() },
    },
    ({ requestId }) => {
      const request = requests.get(requestId);
      if (request === undefined) throw new Error(`no request ${requestId}`);

      return answer({
        status: request.status,
        ...(request.transactionHash === undefined
          ? {}
          : { transactionHash: request.transactionHash }),
      });
    },
  );

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    wallet,
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    approve: async (id) => {
      const request = requests.get(id);
      if (request === undefined || request.status !== "pending") {
        throw new Error(`no pending request ${id}`);
      }
      const hash = await signer.sendTransaction({
        account: owner,
        chain: null,
        to: wallet,
        // Past any estimate, so a batch that reverts is mined and reads as failed.
        gas: 6_000_000n,
        data: encodeFunctionData({
          abi: WALLET,
          functionName: "executeBatch",
          args: [
            request.calls.map((call) => ({
              target: call.to,
              value: BigInt(call.value ?? "0x0"),
              data: (call.data ?? "0x") as Hex,
            })),
          ],
        }),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      request.transactionHash = hash;
      request.status = receipt.status === "success" ? "confirmed" : "failed";
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
