/**
 * The skills as tools, for a client that never reads resources: the list, one skill's files (and
 * nothing else), the SDK's documents by topic, and how to install the skills for each agent. No
 * test names a particular skill except sauce-overview, the entry point every other names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { PACKAGED_SKILLS } from "../../sdk/dist/cli/skills.js";
import { shippedSkills } from "../src/resources.js";
import { packageInfo } from "../src/server.js";
import { DEV_TOPICS, topicsFor } from "../src/skilltools.js";
import { connect, failed, ok, type Connected } from "./harness.js";

let mcp: Connected;
before(async () => {
  mcp = await connect();
});
after(async () => {
  await mcp.close();
});

const skills = shippedSkills();

describe("sauce_skills", () => {
  it("lists every shipped skill with when to use it, and the package's version", async () => {
    const out = ok(await mcp.call("sauce_skills")) as {
      package: string;
      version: string;
      skills: Array<{ name: string; description: string; files: string[] }>;
    };
    assert.equal(out.package, packageInfo().name);
    assert.equal(out.version, packageInfo().version);
    assert.deepEqual(
      out.skills.map((skill) => skill.name),
      skills.map((skill) => skill.name),
    );
    for (const skill of out.skills) {
      assert.ok(skill.description.length > 20, `${skill.name} says when to use it`);
      assert.equal(skill.files[0], "SKILL.md");
    }
    assert.ok(out.skills.some((skill) => skill.name === "sauce-overview"));
  });
});

describe("sauce_skill", () => {
  it("returns a skill's SKILL.md, and each file it lists, as the package ships them", async () => {
    for (const skill of skills) {
      const main = ok(await mcp.call("sauce_skill", { skill: skill.name }));
      assert.equal(main.path, "SKILL.md");
      assert.equal(main.text, readFileSync(join(PACKAGED_SKILLS, skill.dir, "SKILL.md"), "utf8"));
      for (const file of skill.files.slice(1, 3)) {
        const path = file.path.slice(skill.dir.length + 1);
        const out = ok(await mcp.call("sauce_skill", { skill: skill.name, path }));
        assert.equal(out.text, readFileSync(join(PACKAGED_SKILLS, file.path), "utf8"));
      }
    }
  });

  it("serves nothing else: an unknown skill, an unlisted file, or a path out of the skill", async () => {
    assert.match(
      failed(await mcp.call("sauce_skill", { skill: "sauce-nothing" })),
      /no skill named 'sauce-nothing': the skills are sauce-/,
    );
    for (const path of [
      "../sauce-run/SKILL.md",
      "../../package.json",
      "/etc/passwd",
      "references/../../../package.json",
      "references/nope.md",
      ".sauce-skills.json",
    ]) {
      assert.match(
        failed(await mcp.call("sauce_skill", { skill: "sauce-overview", path })),
        /sauce-overview has no file/,
        path,
      );
    }
  });
});

describe("sauce_dev", () => {
  it("returns the TypeScript skill and the documents of a topic, each with its path", async () => {
    const out = ok(await mcp.call("sauce_dev", { topic: "compile" })) as {
      topics: string[];
      skill?: { name: string };
      documents: Array<{ path: string; text: string }>;
    };
    assert.deepEqual(out.topics, ["compile"]);
    assert.ok(out.documents.length > 0);
    for (const document of out.documents) {
      assert.match(document.path, /^docs\/(guides|api|examples|concepts)\//);
      const root = join(PACKAGED_SKILLS, "..");
      assert.equal(document.text, readFileSync(join(root, document.path), "utf8"));
    }
    if (skills.some((skill) => skill.dir === "sauce-typescript")) {
      assert.equal(out.skill?.name, "sauce-typescript");
    }
  });

  it("finds a question's topics from its words, and every topic's documents ship", async () => {
    assert.deepEqual(topicsFor("How do I open a cross-chain intent with a reward?"), ["intents"]);
    assert.deepEqual(topicsFor("compileSauceProgram with compact arguments"), ["compile"]);
    assert.deepEqual(topicsFor("the Solana SVM client and its accounts"), ["solana"]);
    const asked = ok(await mcp.call("sauce_dev", { question: "verify a settle" }));
    assert.deepEqual(asked.topics, ["verification"]);
    for (const { topic, files } of DEV_TOPICS) {
      const out = ok(await mcp.call("sauce_dev", { topic })) as { documents: unknown[] };
      assert.equal(out.documents.length, files.length, `every document of ${topic} ships`);
    }
  });

  it("says which topics there are when a question names none", async () => {
    const out = ok(await mcp.call("sauce_dev", { question: "zzz qqq" })) as {
      topics: string[];
      available: Array<{ topic: string }>;
      documents: unknown[];
    };
    assert.deepEqual(out.topics, []);
    assert.deepEqual(out.documents, []);
    assert.deepEqual(
      out.available.map((entry) => entry.topic),
      DEV_TOPICS.map((entry) => entry.topic),
    );
    assert.equal(
      (await mcp.call("sauce_dev", { topic: "nonsense" })).isError,
      true,
      "a topic not in the list is refused by the schema",
    );
  });
});

describe("sauce_install_skills", () => {
  const AGENTS = ["claude", "codex", "cursor", "copilot", "gemini", "agents-md"] as const;

  it("gives every agent the latest skills' commands, where it reads them, and its MCP config", async () => {
    const reads: Record<string, string[]> = {
      claude: [".claude/skills"],
      codex: [".agents/skills"],
      cursor: [".agents/skills"],
      copilot: [".agents/skills"],
      gemini: [".agents/skills"],
      "agents-md": [".agents/skills", "AGENTS.md"],
    };
    for (const agent of AGENTS) {
      const out = ok(await mcp.call("sauce_install_skills", { agent, dir: "my app" })) as {
        skillsFrom: string[];
        commands: Record<string, string>;
        mcp?: { path: string; config: string };
        notes: string[];
      };
      assert.deepEqual(out.skillsFrom, reads[agent], agent);
      assert.equal(
        out.commands.install,
        `npx -y @eco-incorp/sauce@latest skills install --agent ${agent} --dir "my app"`,
      );
      assert.match(out.commands.update!, /@latest skills update --agent/);
      assert.match(out.commands.status!, /@latest skills status --agent/);
      assert.match(out.commands.init!, /@latest init "my app" --agent/);
      assert.ok(out.notes.some((note) => /no-op on a project already installed/.test(note)));
      if (agent === "agents-md") {
        assert.equal(out.mcp, undefined);
        continue;
      }
      assert.match(out.mcp!.config, /"npx"/);
      assert.match(out.mcp!.config, /"@eco-incorp\/sauce"/);
      assert.match(out.mcp!.config, /"mcp"/);
    }
    const claude = ok(await mcp.call("sauce_install_skills", { agent: "claude" })) as {
      mcp: { path: string; config: string };
    };
    assert.equal(claude.mcp.path, ".mcp.json");
    assert.deepEqual(JSON.parse(claude.mcp.config), {
      mcpServers: {
        sauce: { type: "stdio", command: "npx", args: ["-y", "@eco-incorp/sauce", "mcp"] },
      },
    });
    const codex = ok(await mcp.call("sauce_install_skills", { agent: "codex" })) as {
      mcp: { path: string; config: string };
    };
    assert.equal(codex.mcp.path, ".codex/config.toml");
    assert.match(codex.mcp.config, /^\[mcp_servers\.sauce\]\ncommand = "npx"\n/);
  });

  it("refuses an agent it does not know", async () => {
    assert.equal((await mcp.call("sauce_install_skills", { agent: "vim" })).isError, true);
  });
});
