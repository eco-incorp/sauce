/**
 * `programIntent(…)` opened a document as the route of an intent. Opening an intent is coming soon:
 * it refuses with the SDK's one sentence (`sdk/src/routes/coming-soon.ts`), and a document that
 * compiles still compiles. Offline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compileProgram, programIntent } from "../src/index.js";
import { HOP_SYNTAX, IntentsComingSoonError } from "../../sdk/dist/routes/coming-soon.js";

describe("programIntent", () => {
  it("refuses, naming itself and what acts on an intent that already exists", () => {
    assert.throws(
      () => programIntent({ version: 1, actions: [] }, { chain: "base" }),
      (error: unknown) =>
        error instanceof IntentsComingSoonError &&
        error.site === "`programIntent(…)`" &&
        error.message.startsWith(
          `\`programIntent(…)\`: opening an intent is coming soon. It will be written ${HOP_SYNTAX}; ` +
            "until then, the routes Portal helpers act on intents that already exist",
        ),
    );
  });

  it("compileProgram is untouched", () => {
    const compiled = compileProgram(
      {
        version: 1,
        actions: [
          { type: "transfer", token: "USDC", amount: "1", recipient: `0x${"11".repeat(20)}` },
        ],
      },
      { chain: "base" },
    );
    assert.ok(compiled.bytecode.length > 0);
  });
});
