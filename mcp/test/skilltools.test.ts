/**
 * The skills as tools, for a client that never reads resources: the list, one skill's files (and
 * nothing else), the SDK's documents by topic, and how to install the skills for each agent. No
 * test names a particular skill except sauce-overview, the entry point every other names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
/** The viem installed beside the package, read here on its own. */
const VIEM = (
  JSON.parse(readFileSync(createRequire(import.meta.url).resolve("viem/package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("sauce_skills", () => {
  it("lists every shipped skill with when to use it, and the package's version", async () => {
    const out = ok(await mcp.call("sauce_skills")) as {
      package: string;
      version: string;
      skills: Array<{
        name: string;
        description: string;
        files: Array<{ path: string; bytes: number }>;
        references?: { count: number; some: string[] };
      }>;
    };
    assert.equal(out.package, packageInfo().name);
    assert.equal(out.version, packageInfo().version);
    assert.deepEqual(
      out.skills.map((skill) => skill.name),
      skills.map((skill) => skill.name),
    );
    for (const skill of out.skills) {
      assert.ok(skill.description.length > 20, `${skill.name} says when to use it`);
      assert.equal(skill.files[0]!.path, "SKILL.md");
      assert.ok(skill.files[0]!.bytes > 0, "with its size");
      const shipped = skills.find((each) => each.name === skill.name)!.files.length;
      // A skill with many references lists a few, and counts them all.
      const listed = skill.files.length + (skill.references?.count ?? 0);
      assert.equal(listed, shipped, `${skill.name}: every file listed or counted`);
      if (skill.references !== undefined) assert.ok(skill.references.some.length <= 12);
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

  it("returns one section of a file, or the lines that hold a term", async () => {
    const overview = readFileSync(join(PACKAGED_SKILLS, "sauce-overview", "SKILL.md"), "utf8");
    const heading = /^## (.+)$/m.exec(overview)![1]!;
    const section = ok(
      await mcp.call("sauce_skill", { skill: "sauce-overview", section: heading }),
    );
    assert.ok((section.text as string).startsWith(`## ${heading}`));
    assert.ok((section.text as string).length < overview.length);
    assert.equal(section.bytes, overview.length);
    const word = "Pot";
    const query = ok(await mcp.call("sauce_skill", { skill: "sauce-overview", query: word }));
    for (const line of (query.text as string).split("\n").filter((each) => each !== "…")) {
      assert.match(line, /^\d+: /, "every line numbered");
    }
    assert.ok((query.text as string).includes(word));
    assert.match(
      failed(await mcp.call("sauce_skill", { skill: "sauce-overview", section: "no such part" })),
      /has no heading holding 'no such part': its headings are/,
    );
    assert.match(
      failed(await mcp.call("sauce_skill", { skill: "sauce-overview", query: "zzqqzz" })),
      /holds no 'zzqqzz'/,
    );
  });

  it("serves nothing else: an unknown skill, an unlisted file, or a path out of the skill", async () => {
    assert.match(
      failed(await mcp.call("sauce_skill", { skill: "sauce-nothing" })),
      /no skill named 'sauce-nothing': the skills are sauce-/,
    );
    for (const path of [
      "../sauce-cli/SKILL.md",
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
      // Pinned to this server's own version, everywhere; viem as installed beside the package.
      const pinned = `@eco-incorp/sauce@${packageInfo().version}`;
      assert.equal(out.commands.add, `npm install --save-exact ${pinned} viem@${VIEM}`);
      assert.equal(
        out.commands.install,
        `npx -y ${pinned} skills install --agent ${agent} --dir "my app"`,
      );
      assert.equal(
        out.commands.update,
        `npx -y ${pinned} skills update --agent ${agent} --dir "my app"`,
      );
      assert.equal(
        out.commands.status,
        `npx -y ${pinned} skills status --agent ${agent} --dir "my app"`,
      );
      assert.equal(out.commands.init, `npx -y ${pinned} init "my app" --agent ${agent}`);
      assert.ok(!JSON.stringify(out).includes("@latest"));
      assert.ok(out.notes.some((note) => /no-op on a project already installed/.test(note)));
      assert.ok(
        out.notes.some((note) =>
          note.includes("`sauce <command>`, which `npm i -g @eco-incorp/sauce` installs"),
        ),
      );
      if (agent === "agents-md") {
        assert.equal(out.mcp, undefined);
        continue;
      }
      assert.match(out.mcp!.config, /"npx"/);
      assert.ok(out.mcp!.config.includes(`"${pinned}"`), "the entry mcp setup writes");
      assert.match(out.mcp!.config, /"mcp"/);
      assert.equal(
        out.commands.mcpSetup,
        `npx -y ${pinned} mcp setup --agent ${agent} --dir "my app"`,
      );
    }
    const claude = ok(await mcp.call("sauce_install_skills", { agent: "claude" })) as {
      mcp: { path: string; config: string };
    };
    assert.equal(claude.mcp.path, ".mcp.json");
    const { configSnippet, launch } = await import("../src/setup.js");
    assert.equal(
      claude.mcp.config,
      configSnippet(
        "claude",
        launch({ packageName: "@eco-incorp/sauce", version: packageInfo().version }),
      ).text,
      "exactly what mcp setup writes",
    );
    const withConfig = ok(
      await mcp.call("sauce_install_skills", { agent: "cursor", config: "rpc.json" }),
    ) as { commands: Record<string, string>; mcp: { config: string }; notes: string[] };
    assert.match(withConfig.mcp.config, /"--config",\s*"rpc.json"/);
    assert.match(withConfig.commands.mcpSetup!, /--config "rpc.json"$/);
    assert.ok(withConfig.notes.some((note) => /placeholder/.test(note)));
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
