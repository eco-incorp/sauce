/**
 * `docs/guides/actions.md` lists every supported action with its output. Nothing else ties that
 * list to the code, so this reads it back and compares it with the action table the parser and the
 * lowering use (`ACTION_SPECS`): an action added, renamed or removed, or an output changed, fails
 * here until the guide says so too. It locates rows by their first cell and reads the last, so the
 * prose and the other columns can change freely.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
import { REPO_ROOT } from "./anvil.js";

const GUIDE = readFileSync(resolve(REPO_ROOT, "docs/guides/actions.md"), "utf8");

/** The `type` in the first cell of every table row under "## Supported actions". */
function listedTypes(): string[] {
  const start = GUIDE.indexOf("## Supported actions");
  assert.ok(start >= 0, "the guide has no '## Supported actions' section");
  const end = GUIDE.indexOf("\n## ", start + 1);
  const section = GUIDE.slice(start, end === -1 ? undefined : end);

  return [...section.matchAll(/^\| `([A-Za-z0-9]+)` +\|/gm)].map((m) => m[1]!);
}

describe("docs/guides/actions.md lists the actions the package supports", () => {
  it("every action type exactly once, and nothing else", () => {
    const listed = listedTypes();
    const duplicates = listed.filter((type, i) => listed.indexOf(type) !== i);
    assert.deepEqual(duplicates, [], "listed more than once");
    assert.deepEqual([...listed].sort(), [...ACTION_TYPES].sort());
  });

  it("states each action's output as the lowering produces it", () => {
    const wording = { realized: "received", passThrough: "its amount", value: "the value read" };
    const start = GUIDE.indexOf("## Supported actions");
    for (const type of ACTION_TYPES) {
      const row = new RegExp(`^\\| \`${type}\` +\\|[^\\n]*$`, "m").exec(GUIDE.slice(start))?.[0];
      assert.ok(row, `${type} has no row`);
      const output = row.split("|").at(-2)!.trim();
      assert.equal(output, wording[ACTION_SPECS[type].output], `${type}'s output`);
    }
  });
});
