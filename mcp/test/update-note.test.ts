/**
 * A newer version, noted by the MCP server once: in the first tool result of the process's life,
 * in its structured `notes` and in the JSON text that repeats them, and never again — over HTTP,
 * once across every request's server — and returned by `sauce_skills` as `latest`, on every call.
 * Then `sauce mcp` itself, built, over stdio, with a home of its own whose fresh cache names a newer
 * version: the note in the first result, none after, `latest` in `sauce_skills`, and no refresh
 * started, so nothing reads the registry. The SDK and this workspace must be built.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS } from "../src/config.js";
import { createSauceServer, packageInfo } from "../src/server.js";
import { once, withNote } from "../src/update-note.js";

const NOTE = "A newer @eco-incorp/sauce is available: 999.0.0";

const json = (value: Record<string, unknown>): CallToolResult => ({
  structuredContent: value,
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** A server in process with `updateNote` (and `newerVersion`), and a client that has listed its
 *  tools, so it holds each result to the tool's output schema. */
async function connected(
  updateNote: () => string | undefined,
  newerVersion?: () => string | undefined,
) {
  const server = createSauceServer({
    endpoints: NO_ENDPOINTS,
    updateNote,
    ...(newerVersion === undefined ? {} : { newerVersion }),
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "update-note-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  await client.listTools();

  return {
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Whether `result` carries the note, in its structured notes and in its text. */
const noted = (result: CallToolResult): boolean => {
  const notes = (result.structuredContent as { notes?: string[] } | undefined)?.notes ?? [];
  const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
  const said = notes.some((note) => note.startsWith(NOTE));
  assert.equal(text.includes(NOTE), said, "the text says what the structured notes say");

  return said;
};

describe("the update note", () => {
  it("is asked once: the first answer, then nothing", () => {
    let asked = 0;
    const note = once(() => {
      asked++;

      return NOTE;
    });
    assert.deepEqual([note(), note(), note()], [NOTE, undefined, undefined]);
    assert.equal(asked, 1);
    // Nothing to say the first time is nothing to say for good; a throw is nothing either.
    const quiet = once(() => undefined);
    assert.deepEqual([quiet(), quiet()], [undefined, undefined]);
    assert.equal(
      once(() => {
        throw new Error("no cache");
      })(),
      undefined,
    );
  });

  it("joins a result's structured notes and the JSON text that repeats them", () => {
    const plain = withNote(json({ chains: [] }), NOTE);
    assert.deepEqual(plain.structuredContent, { chains: [], notes: [NOTE] });
    assert.equal(plain.content.length, 1);
    assert.deepEqual(JSON.parse((plain.content[0] as { text: string }).text), {
      chains: [],
      notes: [NOTE],
    });
    const more = withNote(json({ ok: true, notes: ["simulated"] }), NOTE);
    assert.deepEqual(more.structuredContent?.notes, ["simulated", NOTE]);
    // An error's text, or a text that is not the JSON, gets the note as a text of its own.
    const failure = withNote({ isError: true, content: [{ type: "text", text: "no" }] }, NOTE);
    assert.deepEqual(failure, {
      isError: true,
      content: [
        { type: "text", text: "no" },
        { type: "text", text: NOTE },
      ],
    });
    const file = withNote(
      { structuredContent: { text: "# Skill" }, content: [{ type: "text", text: "# Skill" }] },
      NOTE,
    );
    assert.deepEqual(file.structuredContent, { text: "# Skill", notes: [NOTE] });
    assert.deepEqual(file.content.at(-1), { type: "text", text: NOTE });
    // A `notes` that is not a list is left as it is.
    const odd = withNote(json({ notes: "kept" }), NOTE);
    assert.deepEqual(odd.structuredContent, { notes: "kept" });
    assert.deepEqual(odd.content.at(-1), { type: "text", text: NOTE });
  });

  it("is in the first tool result of the server's life, and no other", async () => {
    let asked = 0;
    const server = await connected(
      once(() => {
        asked++;

        return NOTE;
      }),
    );
    try {
      // A call refused before its tool runs asks nothing.
      const refused = await server.call("sauce_skill", {});
      assert.equal(refused.isError, true);
      assert.equal(noted(refused), false);
      assert.equal(asked, 0);
      const first = await server.call("sauce_skills");
      assert.notEqual(first.isError, true);
      assert.equal(noted(first), true);
      for (const [name, args] of [
        ["sauce_skills", {}],
        ["sauce_chains", {}],
        ["sauce_globals", { chain: "base" }],
      ] as const) {
        assert.equal(noted(await server.call(name, args)), false, name);
      }
      assert.equal(asked, 1);
    } finally {
      await server.close();
    }
  });

  it("is said once over HTTP, where every request has a server of its own", async () => {
    const note = once(() => NOTE);
    const first = await connected(note);
    const second = await connected(note);
    try {
      assert.equal(noted(await first.call("sauce_chains")), true);
      assert.equal(noted(await second.call("sauce_chains")), false);
      assert.equal(noted(await first.call("sauce_chains")), false);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe("sauce_skills' latest", () => {
  it("is the newer version, when there is one, beside the version the server runs", async () => {
    let latest: string | undefined = "999.0.0";
    const server = await connected(
      () => undefined,
      () => latest,
    );
    try {
      for (let i = 0; i < 2; i++) {
        const listed = (await server.call("sauce_skills")).structuredContent!;
        assert.deepEqual([listed.version, listed.latest], [packageInfo().version, "999.0.0"]);
      }
      // Nothing newer: no `latest` at all.
      latest = undefined;
      assert.equal("latest" in (await server.call("sauce_skills")).structuredContent!, false);
    } finally {
      await server.close();
    }
    // With the check off, the server is given no newer version.
    const off = await connected(() => undefined);
    try {
      assert.equal("latest" in (await off.call("sauce_skills")).structuredContent!, false);
    } finally {
      await off.close();
    }
  });
});

describe("sauce mcp, built, over stdio", () => {
  const MCP = dirname(dirname(fileURLToPath(import.meta.url)));
  const BIN = join(MCP, "../sdk/dist/cli/main.js");
  let home: string;
  let cache: string;
  let fresh: string;
  before(() => {
    home = mkdtempSync(join(tmpdir(), "sauce-mcp-update-"));
    cache = join(home, ".sauce", "update-check.json");
    mkdirSync(dirname(cache), { recursive: true });
    // A minute old: noticed, and no refresh started.
    fresh = JSON.stringify({
      checkedAt: new Date(Date.now() - 60_000).toISOString(),
      latest: "999.0.0",
      version: packageInfo().version,
    });
    writeFileSync(cache, fresh);
  });
  after(() => rmSync(home, { recursive: true, force: true }));

  /** The results of calling `sauce_chains` twice, then `sauce_skills`, on `sauce mcp …argv`, at
   *  home in `home`. */
  async function twice(...argv: string[]): Promise<CallToolResult[]> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, "mcp", ...argv],
      env: { ...getDefaultEnvironment(), HOME: home, USERPROFILE: home },
      cwd: home,
      stderr: "pipe",
    });
    const client = new Client({ name: "update-note-stdio", version: "0.0.0" });
    await client.connect(transport);
    try {
      const results: CallToolResult[] = [];
      for (let i = 0; i < 2; i++) {
        results.push((await client.callTool({ name: "sauce_chains" })) as CallToolResult);
      }
      results.push((await client.callTool({ name: "sauce_skills" })) as CallToolResult);

      return results;
    } finally {
      await client.close();
    }
  }

  it("notes the newer version its cache names in the first result, and refreshes nothing", async () => {
    const [first, second, skills] = await twice();
    assert.equal(noted(first!), true);
    assert.match(
      (first!.structuredContent as { notes: string[] }).notes.at(-1)!,
      new RegExp(`^${NOTE} \\(this server runs ${packageInfo().version.replace(/\./g, "\\.")}\\)`),
    );
    assert.equal(noted(second!), false);
    assert.equal(noted(skills!), false);
    assert.equal(skills!.structuredContent!.latest, "999.0.0");
    assert.equal(readFileSync(cache, "utf8"), fresh, "a fresh cache starts no refresh");
  });

  it("notes nothing with --offline, or when its --config file turns the check off", async () => {
    const config = join(home, "sauce.config.json");
    writeFileSync(config, JSON.stringify({ rpcUrls: {}, updateCheck: false }));
    for (const argv of [["--offline"], ["--config", config]]) {
      const results = await twice(...argv);
      assert.deepEqual(
        results.map((result) => noted(result)),
        [false, false, false],
        argv.join(" "),
      );
      assert.equal("latest" in results[2]!.structuredContent!, false, argv.join(" "));
    }
  });
});
