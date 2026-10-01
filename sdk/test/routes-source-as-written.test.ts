/**
 * A route source reaches the compiler as written.
 *
 * The compiler runs a file's top-level statements as its entry (a script), so the route adapter has
 * nothing to add to one. It used to wrap any source without a `function main(` in `function main() {
 * ... }`, which moved a script's imports and helper functions inside a function body, where neither
 * is legal: an `import` fails to parse and a nested function is not SauceScript.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import * as routes from "../src/routes/index.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;

const SCRIPT = `import { approve } from "@sauce/token";

function half(amount) {
  return amount / 2n;
}

approve(USDC, RECIPIENT, half(1000n));
`;

describe("a script is compiled as the file it is", () => {
  it("keeps its imports and helper functions at the top level", () => {
    const out = compileSauceRoute("base", SCRIPT, EXECUTION, { defines: { RECIPIENT } });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    // Nothing was added around it: no rewrite applies, so the source is the input.
    expect(out.source).toBe(SCRIPT);
  });

  it("is the same program whether the file is a script or declares `main`", () => {
    const script = compileSauceRoute("base", "require(ctx.timestamp() > 0n);", EXECUTION);
    const declared = compileSauceRoute(
      "base",
      "function main() { require(ctx.timestamp() > 0n); }",
      EXECUTION,
    );

    expect(Array.from(script.compiled.bytecode[0]!)).toEqual(
      Array.from(declared.compiled.bytecode[0]!),
    );
  });

  it("does not turn a top-level `return` into a function body: that needs `function main`", () => {
    // A top-level `return` is not SauceScript, so the compiler says so instead of the SDK guessing
    // which function the statement was meant to be in.
    expect(() => compileSauceRoute("base", "return 7n;", EXECUTION)).toThrow();
    expect(
      compileSauceRoute("base", "function main() { return 7n; }", EXECUTION).compiled.bytecode[0]!
        .length,
    ).toBeGreaterThan(0);
  });

  it("exposes no body-wrapping helper", () => {
    expect("wrapSauceBody" in routes).toBe(false);
  });
});
