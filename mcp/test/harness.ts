/**
 * The server in process, behind an in-memory transport, with a client that keeps every byte it
 * received — so a suite can assert that no endpoint URL ever came back, in a result or an error.
 */
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS, readEndpoints, type Endpoints } from "../src/config.js";
import type { RpcGuard } from "../src/guard.js";
import { createSauceServer } from "../src/server.js";
import type { WalletContext } from "../src/tools.js";

export interface Connected {
  readonly client: Client;
  /** Calls a tool, recording what came back. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Everything the client received, serialized. */
  readonly received: string[];
  close(): Promise<void>;
}

/** Endpoints as a `--config` file with `urls` would give them. */
export const endpointsFor = (urls: Record<string, string>): Endpoints =>
  readEndpoints(JSON.stringify({ rpcUrls: urls }), "test.config.json");

export async function connect(
  endpoints: Endpoints = NO_ENDPOINTS,
  guard?: RpcGuard,
  wallets?: WalletContext,
  /** As over stdio: a program may be named by `path`, read from disk. */
  local = false,
): Promise<Connected> {
  const server = createSauceServer({
    endpoints,
    ...(guard === undefined ? {} : { guard }),
    ...(wallets === undefined ? {} : { wallets }),
    ...(local ? { local: true } : {}),
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "sauce-mcp-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const received: string[] = [client.getInstructions() ?? ""];

  return {
    client,
    received,
    call: async (name, args = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      received.push(JSON.stringify(result));

      return result;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The text of a result's first content block. */
export const textOf = (result: CallToolResult): string => {
  const block = result.content[0];

  return block?.type === "text" ? block.text : "";
};

/** A successful result's structured content; fails with the error text otherwise. */
export function ok(result: CallToolResult): Record<string, unknown> {
  assert.notEqual(result.isError, true, `expected a result, got the error: ${textOf(result)}`);
  assert.ok(result.structuredContent !== undefined, "a result carries structured content");
  assert.deepEqual(
    JSON.parse(textOf(result)),
    result.structuredContent,
    "its text block is the same JSON",
  );

  return result.structuredContent as Record<string, unknown>;
}

/** An error result's message; fails when the call succeeded. */
export function failed(result: CallToolResult): string {
  assert.equal(result.isError, true, `expected an error, got: ${textOf(result)}`);

  return textOf(result);
}
