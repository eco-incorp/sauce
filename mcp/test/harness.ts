/**
 * The server in process, behind an in-memory transport, with a client that keeps every byte it
 * received — so a suite can assert that no endpoint URL ever came back, in a result or an error.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS, readEndpoints, type Endpoints } from "../src/config.js";
import type { RpcGuard } from "../src/guard.js";
import { readPassword } from "../../sdk/dist/cli/password.js";
import type { McpWallets } from "../src/sdk.js";
import { createSauceServer } from "../src/server.js";

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
  wallets?: McpWallets,
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

/**
 * The wallets a stdio server serves, as `sauce mcp` hands them over: `dir`, enabled at start with
 * `start` (as `--password-env SAUCE_TEST_WALLET_PASSWORD` would), else waiting for
 * `sauce_wallet_enable`, whose sources are read as the command reads them — the environment
 * being `env`, never the process's.
 */
export function walletsAt(
  dir: string,
  options: { readonly start?: string; readonly env?: Record<string, string> } = {},
): McpWallets {
  const env = options.env ?? {};

  return {
    dir,
    dirNamed: true,
    ...(options.start === undefined
      ? {}
      : {
          start: {
            password: options.start,
            source: "--password-env SAUCE_TEST_WALLET_PASSWORD",
          },
        }),
    read: (source) =>
      readPassword(
        source,
        {
          readEnv: (name) => env[name],
          readText: (path) => readFileSync(path, "utf8"),
          fileMode: (path) => statSync(path).mode,
          capture: () => {
            throw new Error("a tool never names a command");
          },
          promptPassword: () => {
            throw new Error("a tool never prompts");
          },
        },
        { what: "the wallets", creating: true, by: "tool" },
      ),
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

/**
 * An error result that still carries its structured content, as a rehearsal that reverted does:
 * that content; fails when the call succeeded or carries none.
 */
export function erred(result: CallToolResult): Record<string, unknown> {
  assert.equal(result.isError, true, `expected an error result, got: ${textOf(result)}`);
  assert.ok(result.structuredContent !== undefined, "the error carries structured content");
  assert.deepEqual(JSON.parse(textOf(result)), result.structuredContent);

  return result.structuredContent as Record<string, unknown>;
}

/** An error result's message; fails when the call succeeded. */
export function failed(result: CallToolResult): string {
  assert.equal(result.isError, true, `expected an error, got: ${textOf(result)}`);

  return textOf(result);
}
