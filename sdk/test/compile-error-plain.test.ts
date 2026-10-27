/**
 * A refused program's error is plain text whichever SDK entry compiled it: the compiler's report
 * sets its headlines in bold with ANSI escapes whatever the terminal, and the SDK's one seam onto
 * it (`wasm-compiler.ts`) takes them out, leaving the words and the `diagnostics` as they were.
 */
import { compile as compileRaw } from "sauce-compiler";

import { compile } from "../src/compiler.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

const SOURCE = "function main(): Uint256 {\n  const a: Uint256 = 1;\n  a = 2;\n  return a;\n}\n";
const options = {
  target: "evm" as const,
  resolve: (path: string) => (path === "main.js" ? new TextEncoder().encode(SOURCE) : undefined),
};
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const thrown = (run: () => unknown): Error & { diagnostics?: unknown } => {
  try {
    run();
  } catch (error) {
    return error as Error & { diagnostics?: unknown };
  }
  throw new Error("compiled");
};

describe("a compile error's message is plain text", () => {
  const raw = thrown(() => compileRaw(options));

  it("the compiler itself styles it", () => {
    expect(raw.message).toContain(String.fromCharCode(27));
  });

  it.each([
    ["/compiler compile", () => compile(options)],
    ["compileSauceProgram", () => compileSauceProgram("base", SOURCE)],
    [
      "compileSauceRoute",
      () =>
        compileSauceRoute("base", SOURCE, {
          pot: "0x1111111111111111111111111111111111111111",
          engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        }),
    ],
  ])("%s: the compiler's words, without escapes, and its diagnostics", (_, run) => {
    const error = thrown(run);
    expect(error.message).not.toContain(String.fromCharCode(27));
    expect(error.message).toBe(raw.message.replace(SGR, ""));
    expect(error.stack).not.toContain(String.fromCharCode(27));
    expect(error.diagnostics).toEqual(raw.diagnostics);
  });

  // A host's `Error.prepareStackTrace` may make `stack` anything (here the frames): the escapes are
  // taken out of what is a string, and the compiler's own error is what is thrown, its diagnostics
  // with it.
  it.each([
    ["/compiler compile", () => compile(options)],
    ["compileSauceProgram", () => compileSauceProgram("base", SOURCE)],
  ])("%s: the compiler's error, whatever a host makes its stack", (_, run) => {
    const prepare = Error.prepareStackTrace;
    Error.prepareStackTrace = (_error, frames) => frames;
    let error: Error & { diagnostics?: unknown };
    try {
      error = thrown(run);
    } finally {
      Error.prepareStackTrace = prepare;
    }
    expect(error.message).toBe(raw.message.replace(SGR, ""));
    expect(error.diagnostics).toEqual(raw.diagnostics);
    expect(Array.isArray(error.stack)).toBe(true);
  });
});
