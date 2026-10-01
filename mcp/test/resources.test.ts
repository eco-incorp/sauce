/**
 * The agent skills as resources, and the prompts: every file the package ships under `skills/`
 * is listed and reads back as it is on disk, the index names them all, and every resource a prompt
 * or the server's instructions point at exists. Nothing here names a particular skill file: the
 * skills are the package's to change, and this holds whatever it ships.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { after, before, describe, it } from "node:test";

import { PACKAGED_SKILLS } from "../../sdk/dist/cli/skills.js";
import { PROMPT_NAMES } from "../src/prompts.js";
import { SKILLS_INDEX } from "../src/resources.js";
import { connect, type Connected } from "./harness.js";

/** Every file under the package's skills/, as the package ships it. */
const shipped = readdirSync(PACKAGED_SKILLS, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    relative(PACKAGED_SKILLS, join(entry.parentPath, entry.name)).split(sep).join("/"),
  )
  .filter((path) => path.includes("/") && !path.split("/").some((part) => part.startsWith(".")))
  .sort();

let mcp: Connected;
before(async () => {
  mcp = await connect();
});
after(async () => {
  await mcp.close();
});

const textOf = (contents: ReadonlyArray<object>): string => {
  const first = contents[0] as { text?: unknown } | undefined;
  assert.equal(typeof first?.text, "string");

  return first!.text as string;
};

describe("the skills as resources", () => {
  it("lists every shipped file at sauce://skills/<path>, and the index", async () => {
    const { resources } = await mcp.client.listResources();
    const uris = resources.map((resource) => resource.uri);
    assert.ok(shipped.length > 0, "the package ships skills");
    assert.deepEqual(
      uris.filter((uri) => uri !== SKILLS_INDEX).sort(),
      shipped.map((path) => `sauce://skills/${path}`),
    );
    assert.ok(uris.includes(SKILLS_INDEX));
    for (const resource of resources) {
      assert.ok(resource.mimeType, `${resource.uri} has a type`);
      assert.ok((resource.description ?? "").length > 0, `${resource.uri} is described`);
    }
  });

  it("names each skill by its SKILL.md and describes it by its frontmatter", async () => {
    const { resources } = await mcp.client.listResources();
    for (const path of shipped.filter((file) => /^[^/]+\/SKILL\.md$/.test(file))) {
      const resource = resources.find((each) => each.uri === `sauce://skills/${path}`)!;
      const text = readFileSync(join(PACKAGED_SKILLS, path), "utf8");
      const name = /^name:\s*(.+)$/m.exec(text)?.[1];
      assert.equal(resource.name, name ?? path.split("/")[0]);
      assert.equal(resource.mimeType, "text/markdown");
    }
  });

  it("reads each file back exactly as the package ships it", async () => {
    for (const path of shipped) {
      const { contents } = await mcp.client.readResource({ uri: `sauce://skills/${path}` });
      assert.equal(textOf(contents), readFileSync(join(PACKAGED_SKILLS, path), "utf8"), path);
    }
  });

  it("indexes every skill and every file", async () => {
    const { contents } = await mcp.client.readResource({ uri: SKILLS_INDEX });
    const index = textOf(contents);
    for (const path of shipped) assert.ok(index.includes(`sauce://skills/${path}`), path);
  });

  it("serves nothing it did not list", async () => {
    await assert.rejects(mcp.client.readResource({ uri: "sauce://skills/../package.json" }));
    await assert.rejects(mcp.client.readResource({ uri: "sauce://skills/nope/SKILL.md" }));
  });
});

describe("the prompts", () => {
  it("lists the task prompts with their arguments", async () => {
    const { prompts } = await mcp.client.listPrompts();
    assert.deepEqual(
      prompts.map((prompt) => prompt.name),
      [...PROMPT_NAMES],
    );
    for (const prompt of prompts) {
      assert.ok(prompt.arguments?.some((arg) => arg.name === "task" && arg.required === true));
    }
  });

  it("points only at resources the server serves, and embeds the skill a task starts from", async () => {
    const { resources } = await mcp.client.listResources();
    const served = new Set(resources.map((resource) => resource.uri));
    const pointed = (text: string) => text.match(/sauce:\/\/skills\/[\w./-]+[\w]/g) ?? [];
    for (const uri of pointed(mcp.client.getInstructions() ?? "")) {
      assert.ok(served.has(uri), `the instructions name ${uri}`);
    }
    for (const name of PROMPT_NAMES) {
      const { messages } = await mcp.client.getPrompt({
        name,
        arguments: { task: "pay a friend 5 USDC", chain: "base" },
      });
      const [first, ...rest] = messages;
      assert.equal(first?.content.type, "text");
      const text = (first!.content as { text: string }).text;
      assert.match(text, /pay a friend 5 USDC/);
      assert.match(text, /never ask for a private key/);
      for (const uri of pointed(text)) assert.ok(served.has(uri), `${name} names ${uri}`);
      for (const message of rest) {
        assert.equal(message.content.type, "resource");
        const resource = (message.content as { resource: { uri: string; text: string } }).resource;
        assert.ok(served.has(resource.uri), `${name} embeds ${resource.uri}`);
        const { contents } = await mcp.client.readResource({ uri: resource.uri });
        assert.equal(resource.text, textOf(contents));
      }
    }
  });
});
