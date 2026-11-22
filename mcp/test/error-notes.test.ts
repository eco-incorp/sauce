/**
 * What a tool returns when the command it calls fails and says more than its message. A failure
 * that carries notes (`CliError#notes`: what a Pot's state means for the cook that just failed) has
 * them returned in its error result after the message, in the tools' words, as the command prints
 * them on stderr: a caller that only reads the error is told why, not only that it failed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS } from "../src/config.js";
import { CliError } from "../src/sdk.js";
import { toolRegistrar, type ToolOutput } from "../src/tools.js";
import { failed } from "./harness.js";

/** A failure of the command: its message, and the notes it says beside it. */
const failure = (message: string, notes: readonly string[]): CliError =>
  Object.assign(new CliError(message), { notes });

/** One tool, registered as the server registers its own, that runs `run`; called once. */
async function call(run: () => ToolOutput): Promise<CallToolResult> {
  const server = new McpServer({ name: "error-notes-test", version: "0.0.0" });
  toolRegistrar(server, { endpoints: NO_ENDPOINTS })(
    "probe",
    {
      title: "Probe",
      description: "Runs what the test gives it.",
      input: {},
      output: {},
      annotations: { readOnlyHint: true },
    },
    run,
  );
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "error-notes-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return (await client.callTool({ name: "probe", arguments: {} })) as CallToolResult;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("a tool whose command fails with notes", () => {
  it("returns the notes in its error result, after the message", async () => {
    const result = await call(() => {
      throw failure('the cook would fail, so it was not sent: the program threw "x"', [
        "the Pot P is owned by v12-svm 1.3.0 (E); it is cooked on v12-svm 1.4.1, as earlier SDKs " +
          "did. Inside the program ctx.self() is the installed engine",
        "a second note",
      ]);
    });

    assert.deepEqual(failed(result).split("\n"), [
      'the cook would fail, so it was not sent: the program threw "x"',
      "the Pot P is owned by v12-svm 1.3.0 (E); it is cooked on v12-svm 1.4.1, as earlier SDKs did. " +
        "Inside the program ctx.self() is the installed engine",
      "a second note",
    ]);
  });

  it("puts a note in the tools' words, as it does the message: an input where the command names a flag", async () => {
    const result = await call(() => {
      throw failure("the Pot needs another salt (--salt <label>)", [
        "pass --pot <address> to name the Pot",
      ]);
    });

    const [message, note] = failed(result).split("\n");
    assert.ok(!message!.includes("--salt"), message);
    assert.ok(!note!.includes("--pot"), note);
    assert.match(note!, /pot <address>/);
  });

  it("returns the message alone for a failure that carries none, or that is not the command's", async () => {
    assert.equal(
      failed(
        await call(() => {
          throw new CliError("no notes here");
        }),
      ),
      "no notes here",
    );
    // `notes` on an error that is not a CliError is not the command's: it says nothing of it.
    assert.equal(
      failed(
        await call(() => {
          throw Object.assign(new Error("plain"), { notes: ["not said"] });
        }),
      ),
      "plain",
    );
  });
});
