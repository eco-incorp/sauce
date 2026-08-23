/**
 * P6 — the compiler-selector seam at `compileSauceRoute` (`sauce-route.ts`). `options.compiler`
 * ('ts', the default, or 'rs') decides whether `compile()` runs through the existing
 * `@eco-incorp/sauce-compiler` TypeScript compiler or through the RS/WASM compiler adapter
 * (`rs-compile.ts`). The payoff is `ambient` (module exports broadcast into every module with no
 * `import` line) -- a capability that exists ONLY on the RS path today.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireChain } from "../src/chains/canonical.js";
import { compileSauceRoute } from "../src/routes/index.js";
import type { SauceEvmExecutionInput } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const AMBIENT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rs-ambient");

const execution: SauceEvmExecutionInput = { pot: POT };
const base = requireChain("base");

describe("compileSauceRoute: compiler selector ('ts' default vs 'rs')", () => {
  it("compiles a simple program through compiler:'ts' (the default) with non-empty bytecode", () => {
    const built = compileSauceRoute(base, "return 41n + 1n;", execution, { compiler: "ts" });
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("compiles the SAME simple program through compiler:'rs' with non-empty bytecode", () => {
    const built = compileSauceRoute(base, "return 41n + 1n;", execution, { compiler: "rs" });
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("omitting `compiler` entirely still compiles (the default is 'ts', unregressed)", () => {
    const built = compileSauceRoute(base, "return 1n;", execution, {});
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a destination-defaulted target ('v12' for an evm chain) reaches the RS adapter and compiles", () => {
    // compileSauceRoute defaults `target` to 'v12' for an evm destination when options.target is
    // omitted -- proving the selector's target-mapping (v1/v12 -> RS 'evm') is actually exercised,
    // not just a same-value coincidence from an explicit target.
    const built = compileSauceRoute(base, "return 7n;", execution, { compiler: "rs" });
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("compileSauceRoute: ambient (RS-compiler-only) end to end", () => {
  const AMBIENT = ["./math-helpers.js"];
  const bareBody = "return double(21n);"; // no `import` line anywhere

  it("compiler:'rs' + options.ambient compiles a program that calls an un-imported ambient export", () => {
    const built = compileSauceRoute(base, bareBody, execution, {
      compiler: "rs",
      baseDirs: [AMBIENT_FIXTURE_DIR],
      ambient: AMBIENT,
    });
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("negative control: compiler:'rs' WITHOUT options.ambient fails to compile the identical body", () => {
    // Proves the previous test's success is `ambient` doing the work, not just "the RS compiler is
    // more lenient" -- `double` is genuinely undeclared/unimported here.
    expect(() =>
      compileSauceRoute(base, bareBody, execution, {
        compiler: "rs",
        baseDirs: [AMBIENT_FIXTURE_DIR],
      }),
    ).toThrow();
  });

  it("negative control: compiler:'ts' (default) never sees `options.ambient` -- the identical call fails", () => {
    // The TS compiler this repo vendors has no `ambient` concept at all (see rs-compile.ts's and
    // sauce-route.ts's own doc notes) -- `options.ambient` is silently unused on this path, so the
    // exact same source/options pair that compiles above still fails to compile here.
    expect(() =>
      compileSauceRoute(base, bareBody, execution, {
        compiler: "ts",
        baseDirs: [AMBIENT_FIXTURE_DIR],
        ambient: AMBIENT,
      }),
    ).toThrow();
  });

  it("ambient produces BYTE-IDENTICAL bytecode to the same call made through an explicit import", () => {
    // The strongest available parity check without an execution engine: `ambient` is documented
    // (rs-compile.ts / the RS compiler's own d.ts) as broadcasting a module's exports "exactly as
    // if every module had imported it" -- so the ambient-compiled program and the equivalent
    // program with an explicit `import { double } from "./math-helpers.js"` line, both compiled
    // via compiler:'rs', must produce the exact same bytecode.
    const viaAmbient = compileSauceRoute(base, bareBody, execution, {
      compiler: "rs",
      baseDirs: [AMBIENT_FIXTURE_DIR],
      ambient: AMBIENT,
    });
    const viaExplicitImport = compileSauceRoute(
      base,
      // Written as a complete `function main(){...}` program (not a bare body) so
      // `wrapSauceBody` leaves it untouched -- wrapping would otherwise nest the top-level
      // `import` inside the synthesized function body, which is invalid JS/TS.
      `import { double } from "./math-helpers.js";\nfunction main() { ${bareBody} }`,
      execution,
      { compiler: "rs", baseDirs: [AMBIENT_FIXTURE_DIR] },
    );
    expect(Array.from(viaAmbient.compiled.bytecode[0]!)).toEqual(Array.from(viaExplicitImport.compiled.bytecode[0]!));
    expect(viaAmbient.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
