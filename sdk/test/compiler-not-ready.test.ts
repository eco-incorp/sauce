/**
 * A compile before `ready()` where the wasm loads asynchronously (a browser).
 *
 * The browser build's glue cannot compile until its wasm is initialized, and on its own reports that
 * as a `TypeError` about an undefined `wasm`. The seam (`src/wasm-compiler.ts`) must instead throw
 * the SDK's instruction to `await ready()`, and compile normally once it has. Jest runs the Node
 * build, which is always initialized, so an uninitialized glue stands in for the browser's here;
 * `scripts/check-browser-compile.mjs` shows the same thing in Chromium against the real one.
 */
// ESM jest exposes `jest` on `import.meta`, and the module under test must be imported after the
// mocks are registered — dynamically, below.
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};

let initialized = false;
jest.unstable_mockModule("sauce-compiler", () => ({
  compile: () => ({ bytecode: new Uint8Array([1]) }),
  functionCacheStats: () => {
    if (!initialized) {
      throw new TypeError("Cannot read properties of undefined (reading 'functionCacheStats')");
    }

    return { hits: 0, misses: 0, inserts: 0 };
  },
}));
jest.unstable_mockModule("sauce-compiler/ready", () => ({
  ready: async () => {
    initialized = true;
  },
}));

const { compile, ready } = await import("../src/wasm-compiler.js");
const SOURCE = new TextEncoder().encode("function main(): Uint256 { return 42n; }");

describe("a compile before ready()", () => {
  it("throws the SDK's instruction, then compiles once ready() has resolved", async () => {
    const early = () => compile({ target: "evm", resolve: () => SOURCE });
    expect(early).toThrow(/await ready\(\)/);
    expect(early).toThrow(/@eco-incorp\/sauce\/compiler/);
    await ready();
    expect(early().bytecode).toEqual(new Uint8Array([1]));
  });
});
