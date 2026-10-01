/**
 * `sauce-mcp setup`: each agent's project file, in the shape its vendor documents, written once,
 * merged into what a file already holds, never overwritten without `force`, and left alone when it
 * is not plain JSON.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { launch, parseSetupAgents, SETUP_AGENTS, setupProject } from "../src/setup.js";

const PACKAGE = { packageName: "@eco-incorp/sauce", version: "9.9.9" };
const ARGS = ["-y", "-p", "@eco-incorp/sauce@9.9.9", "sauce-mcp"];

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "sauce-mcp-setup-"));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const json = (path: string) => JSON.parse(readFileSync(join(project, path), "utf8"));
const run = (overrides: Partial<Parameters<typeof setupProject>[0]> = {}) =>
  setupProject({ project, agents: [...SETUP_AGENTS], force: false, ...PACKAGE, ...overrides });

describe("sauce-mcp setup", () => {
  it("writes each agent's file, launching this package's bin at this version", () => {
    const files = run({ config: "sauce.config.json" });
    assert.deepEqual(
      files.map((file) => [file.path, file.state]),
      [
        [".mcp.json", "wrote"],
        [join(".codex", "config.toml"), "wrote"],
        [join(".cursor", "mcp.json"), "wrote"],
        [join(".vscode", "mcp.json"), "wrote"],
        [join(".gemini", "settings.json"), "wrote"],
      ],
    );
    const args = [...ARGS, "--config", "sauce.config.json"];
    const stdio = { type: "stdio", command: "npx", args };
    assert.deepEqual(json(".mcp.json"), { mcpServers: { sauce: stdio } });
    assert.deepEqual(json(".cursor/mcp.json"), { mcpServers: { sauce: stdio } });
    assert.deepEqual(json(".vscode/mcp.json"), { servers: { sauce: stdio } });
    assert.deepEqual(json(".gemini/settings.json"), {
      mcpServers: { sauce: { command: "npx", args } },
    });
    assert.equal(
      readFileSync(join(project, ".codex/config.toml"), "utf8"),
      [
        "[mcp_servers.sauce]",
        'command = "npx"',
        `args = [${args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
        "",
      ].join("\n"),
    );
    assert.deepEqual(launch({ ...PACKAGE }).args, ARGS);
  });

  it("is a no-op the second time", () => {
    run();
    assert.ok(run().every((file) => file.state === "unchanged"));
  });

  it("keeps everything else a file holds, and adds to it", () => {
    mkdirSync(join(project, ".gemini"));
    writeFileSync(
      join(project, ".gemini/settings.json"),
      JSON.stringify({ theme: "dark", mcpServers: { other: { command: "other" } } }),
    );
    mkdirSync(join(project, ".codex"));
    writeFileSync(
      join(project, ".codex/config.toml"),
      'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n',
    );
    const files = run({ agents: ["gemini", "codex"] });
    assert.deepEqual(
      files.map((file) => file.state),
      ["added", "added"],
    );
    assert.deepEqual(json(".gemini/settings.json"), {
      theme: "dark",
      mcpServers: { other: { command: "other" }, sauce: { command: "npx", args: ARGS } },
    });
    const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
    assert.ok(
      toml.startsWith('model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n\n[mcp_servers.sauce]\n'),
    );
    assert.ok(run({ agents: ["codex"] }).every((file) => file.state === "unchanged"));
  });

  it("never replaces a sauce entry that differs, unless forced", () => {
    run({ agents: ["claude", "codex"], config: "old.json" });
    const kept = run({ agents: ["claude", "codex"] });
    assert.deepEqual(
      kept.map((file) => file.state),
      ["kept", "kept"],
    );
    assert.deepEqual(json(".mcp.json").mcpServers.sauce.args, [...ARGS, "--config", "old.json"]);
    const forced = run({ agents: ["claude", "codex"], force: true });
    assert.deepEqual(
      forced.map((file) => file.state),
      ["overwrote", "overwrote"],
    );
    assert.deepEqual(json(".mcp.json").mcpServers.sauce.args, ARGS);
    assert.doesNotMatch(readFileSync(join(project, ".codex/config.toml"), "utf8"), /old\.json/);
  });

  it("leaves a sauce server Codex's file already names another way alone", () => {
    mkdirSync(join(project, ".codex"));
    for (const spelling of [
      '[mcp_servers."sauce"]\ncommand = "other"\n',
      "[mcp_servers.sauce] # mine\ncommand = 'other'\n",
      '[mcp_servers]\nsauce = { command = "other" }\n',
      'mcp_servers.sauce.command = "other"\n',
    ]) {
      writeFileSync(join(project, ".codex/config.toml"), spelling);
      for (const force of [false, true]) {
        assert.deepEqual(
          run({ agents: ["codex"], force }).map((file) => file.state),
          ["kept"],
          spelling,
        );
        assert.equal(readFileSync(join(project, ".codex/config.toml"), "utf8"), spelling);
      }
    }
  });

  it("reads its own table back as unchanged whatever the file's line endings", () => {
    run({ agents: ["codex"] });
    const file = join(project, ".codex/config.toml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    assert.deepEqual(
      run({ agents: ["codex"] }).map((each) => each.state),
      ["unchanged"],
    );
  });

  it("leaves a file that is not plain JSON alone, saying what to add", () => {
    mkdirSync(join(project, ".vscode"));
    writeFileSync(join(project, ".vscode/mcp.json"), '{\n  // mine\n  "servers": {}\n}\n');
    assert.throws(() => run({ agents: ["copilot"] }), /not plain JSON[^]*"sauce"/);
    assert.ok(!existsSync(join(project, ".mcp.json")));
  });

  it("takes agents by name, comma-separated or repeated, and all", () => {
    assert.deepEqual(parseSetupAgents([]), [...SETUP_AGENTS]);
    assert.deepEqual(parseSetupAgents(["claude,cursor", "claude"]), ["claude", "cursor"]);
    assert.deepEqual(parseSetupAgents(["all"]), [...SETUP_AGENTS]);
    assert.throws(() => parseSetupAgents(["vim"]), /'vim' is not one of/);
  });
});
