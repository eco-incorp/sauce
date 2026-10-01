/**
 * Every corpus program, and one program per shape the SDK's rewrites lowered, compiles to the
 * bytecode the native pipeline was proven to produce.
 *
 * `routes-native-parity.test.ts` showed, case by case, that the native pipeline compiles the corpus
 * exactly as the SDK's source rewrites did. This holds it there once those rewrites are deleted: the
 * fixture (`fixtures/native-golden.json`) records each case's bytecode digest — or that it is
 * refused — and the parameters given a filler value so the program could compile at all.
 *
 * The digests were recorded by the parity suite that compared the two pipelines, while the rewrites
 * existed (eco-incorp/sauce#43–#45). They are a compiler's output, so a compiler bump that changes
 * code generation moves them: `UPDATE_NATIVE_GOLDEN=1` re-records them from what compiles now, and a
 * digest that moves needs the reason it moved.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSauceProgram } from "../src/routes/sauce-route.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = join(ROOT, "sdk/test/fixtures/native-golden.json");
const GOLDEN = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
  string,
  {
    readonly source?: string;
    readonly defines: readonly string[];
    readonly sha256?: string;
    readonly error?: true;
  }
>;

const INTENTS = {
  deadline: 1_900_000_000n,
  creator: "0x1111111111111111111111111111111111111111",
  executionFee: 1n,
} as const;
const FILLER = 0x3333333333333333333333333333333333333333n;
/** What `UPDATE_NATIVE_GOLDEN=1` re-records. */
const recorded: Record<string, unknown> = {};

describe("the corpus and the shapes compile to their recorded bytecode", () => {
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const at = key.lastIndexOf("@");
    const [file, chain] = [key.slice(0, at), key.slice(at + 1)];
    it(key, () => {
      // A shape case carries its source; a corpus case names its file.
      const source = expected.source ?? readFileSync(join(ROOT, file), "utf8");
      const defines = Object.fromEntries(expected.defines.map((name) => [name, FILLER]));
      const compile = () =>
        compileSauceProgram(chain, source, { intents: INTENTS, defines } as never).bytecode;
      if (expected.error) {
        expect(compile).toThrow();
        return;
      }
      const sha256 = createHash("sha256").update(compile()).digest("hex");
      if (process.env.UPDATE_NATIVE_GOLDEN === "1") {
        recorded[key] = { ...expected, sha256 };
        return;
      }
      expect(sha256).toBe(expected.sha256);
    });
  }
  afterAll(() => {
    if (process.env.UPDATE_NATIVE_GOLDEN === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify({ ...GOLDEN, ...recorded }, null, 2)}\n`);
    }
  });
});
