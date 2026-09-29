/**
 * `ready()` in Node (`src/wasm-compiler.ts`).
 *
 * In Node the compiler's wasm is instantiated on import, so every compile works with no `ready()`
 * and `ready()` resolves at once. The browser half — a compile before `ready()` fails with the SDK's
 * own instruction — is `compiler-not-ready.test.ts`, and `scripts/check-browser-compile.mjs` shows it
 * in Chromium.
 */
import { compile, ready } from "../src/compiler.js";
import * as root from "../src/index.js";

const SOURCE = new TextEncoder().encode("function main(): Uint256 { return 42n; }");

describe("ready() in Node", () => {
  it("is not needed: compiling works first, and ready() resolves and changes nothing", async () => {
    const before = compile({ target: "evm", resolve: () => SOURCE }).bytecode;
    await expect(ready()).resolves.toBeUndefined();
    // Node ignores a source: the bytes are always the package's own.
    await expect(ready(new Uint8Array([0, 1, 2]))).resolves.toBeUndefined();
    expect(compile({ target: "evm", resolve: () => SOURCE }).bytecode).toEqual(before);
  });

  it("is the same function from the package root and from the compiler subpath", () => {
    expect(root.ready).toBe(ready);
  });
});
