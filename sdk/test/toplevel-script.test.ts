/**
 * Top-level statements are the script entry point: a program whose body is a top-level
 * call/assignment statement compiles WITHOUT a `function main` wrapper, and those statements ARE the
 * implicit main body.
 *
 * The compiler gained this in 0.6.0; it is asserted here against whatever version the workspaces
 * resolve, through the SDK's own `./compiler` subpath (`src/compiler.ts`, the published re-export
 * consumers use) — so a later compiler that regressed it fails here rather than at a consumer.
 *
 * Boundary: the route DSL still wraps a bare body via `wrapSauceBody`, since a body containing
 * `return` needs a function and a top-level `return` is still an error — see `sauce-route.ts`.
 */
import { compile } from "../src/compiler.js";

const ENTRY = "main.js";

/** Compile a self-contained source (no imports) through the SDK's `./compiler` re-export. */
function compileEvm(source: string): Uint8Array {
  return compile({
    target: "evm",
    entry: ENTRY,
    resolve: (path: string) => (path === ENTRY ? new TextEncoder().encode(source) : undefined),
  }).bytecode;
}

describe("top-level statements as the script entry", () => {
  it("a top-level call statement compiles with no `function main` wrapper", () => {
    const bytecode = compileEvm("function sink(x: Uint256): void {}\nsink(5n);");
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it("a top-level assignment statement compiles with no wrapper", () => {
    const bytecode = compileEvm("let total: Uint256 = 0n;\ntotal = total + 5n;");
    expect(bytecode.length).toBeGreaterThan(0);
  });

  /**
   * That the top-level statements are really COMPILED, not accepted and discarded — a literal in
   * them reaches the output.
   *
   * This replaces a "byte-identical to the same statements wrapped in `function main`" assertion,
   * which is NOT true in general: for a body that does something, the two forms differ (a
   * module-level assignment compiles to 9 bytes as a script and 23 wrapped, since the wrapper
   * allocates). It held only for a `sink()` whose empty body let the optimizer reduce both to the
   * same 12-byte stub — which is also why that test could not tell `sink(5n)` from `sink(6n)`.
   */
  it("compiles the top-level statements themselves — a literal in them reaches the bytecode", () => {
    const five = compileEvm("let total: Uint256 = 0n;\ntotal = total + 5n;");
    const six = compileEvm("let total: Uint256 = 0n;\ntotal = total + 6n;");

    expect(Array.from(five)).not.toEqual(Array.from(six));
    expect(five.length).toBe(six.length);
  });

  it("negative control: a program with only declarations (no executable statement) still errors", () => {
    // A script needs at least one top-level call/assignment; pure declarations are not an entry.
    expect(() => compileEvm("let x: Uint256 = 5n;")).toThrow();
  });

  it("negative control: a top-level `return` is still an error (return needs a function body)", () => {
    expect(() => compileEvm("return 5n;")).toThrow();
  });
});
