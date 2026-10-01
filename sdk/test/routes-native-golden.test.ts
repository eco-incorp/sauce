/**
 * Every corpus program compiles to the bytecode the native pipeline was proven to produce.
 *
 * `routes-native-parity.test.ts` showed, case by case, that the native pipeline compiles the corpus
 * exactly as the SDK's source rewrites did. This holds it there once those rewrites are deleted: the
 * fixture (`fixtures/native-golden.json`) records each case's bytecode digest — or that it is
 * refused — and the parameters given a filler value so the program could compile at all.
 *
 * The digests are a compiler's output, so a compiler bump that changes code generation changes them.
 * Re-prove and re-record with the parity suite, where the rewrites still exist:
 * `UPDATE_NATIVE_GOLDEN=1 pnpm --filter ./sdk test -- routes-native-parity`. After they are gone, a
 * digest that moves needs the reason it moved.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSauceProgram } from "../src/routes/sauce-route.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOLDEN = JSON.parse(
  readFileSync(join(ROOT, "sdk/test/fixtures/native-golden.json"), "utf8"),
) as Record<
  string,
  { readonly defines: readonly string[]; readonly sha256?: string; readonly error?: true }
>;

const INTENTS = {
  deadline: 1_900_000_000n,
  creator: "0x1111111111111111111111111111111111111111",
  executionFee: 1n,
} as const;
const FILLER = 0x3333333333333333333333333333333333333333n;

describe("the corpus compiles to its recorded bytecode", () => {
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const at = key.lastIndexOf("@");
    const [file, chain] = [key.slice(0, at), key.slice(at + 1)];
    it(key, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      const defines = Object.fromEntries(expected.defines.map((name) => [name, FILLER]));
      const compile = () =>
        compileSauceProgram(chain, source, { intents: INTENTS, defines } as never).bytecode;
      if (expected.error) {
        expect(compile).toThrow();
        return;
      }
      expect(createHash("sha256").update(compile()).digest("hex")).toBe(expected.sha256);
    });
  }
});
