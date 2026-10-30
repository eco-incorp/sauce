/**
 * The Sauce release's addresses, which the skills write in one file, reach an agent that has only
 * this server: the file is listed as a JSON resource, read back as the package ships it, and handed
 * out by `sauce_skill` and named by `sauce_skills`. It lists current release metadata, not
 * authenticated provenance for a caller's deployed Pot. This suite names a skill file: the deployment's, not a
 * skill's to rename.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { PACKAGED_SKILLS } from "../../sdk/dist/cli/skills.js";
import {
  v12EngineAddress,
  v12KitchenAddress,
  v12RouterAddress,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../../sdk/dist/deployments/index.js";
import { connect, ok, type Connected } from "./harness.js";

const SKILL = "sauce-chains";
const PATH = "references/deployments.json";
const URI = `sauce://skills/${SKILL}/${PATH}`;
const shipped = readFileSync(join(PACKAGED_SKILLS, SKILL, PATH), "utf8");

interface Deployments {
  evm: Record<"engine" | "kitchen" | "router", { address: string }> & {
    pot: { address: string; helperInitCodeHash: string };
  };
  svm: Record<"engine" | "kitchen", { programId: string }>;
}

let mcp: Connected;
before(async () => {
  mcp = await connect();
});
after(async () => {
  await mcp.close();
});

describe("the deployments file", () => {
  it("holds current release addresses and the explicit CREATE3 factory derivation", () => {
    const { evm, svm } = JSON.parse(shipped) as Deployments;
    assert.equal(evm.engine.address, v12EngineAddress());
    assert.equal(evm.kitchen.address, v12KitchenAddress());
    assert.equal(evm.router.address, v12RouterAddress());
    assert.equal(evm.pot.address, "CREATE3(kitchen, keccak256(abi.encode(owner, salt)))");
    assert.equal(
      evm.pot.helperInitCodeHash,
      "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f",
    );
    assert.equal(svm.engine.programId, v12SvmEngineProgramId());
    assert.equal(svm.kitchen.programId, v12SvmKitchenProgramId());
  });

  it("is a JSON resource that reads back as the package ships it", async () => {
    const { resources } = await mcp.client.listResources();
    const resource = resources.find((each) => each.uri === URI);
    assert.ok(resource !== undefined, `${URI} is listed`);
    assert.equal(resource.mimeType, "application/json");
    const { contents } = await mcp.client.readResource({ uri: URI });
    assert.equal((contents[0] as { text?: string }).text, shipped);
  });

  it("is listed by sauce_skills and returned by sauce_skill", async () => {
    const { skills } = ok(await mcp.call("sauce_skills")) as {
      skills: Array<{ name: string; files: Array<{ path: string }> }>;
    };
    const chains = skills.find((skill) => skill.name === SKILL);
    assert.ok(
      chains?.files.some((file) => file.path === PATH),
      `sauce_skills lists ${PATH}, not only a summary of the documents beside it`,
    );
    const out = ok(await mcp.call("sauce_skill", { skill: SKILL, path: PATH }));
    assert.equal(out.text, shipped);
  });
});
