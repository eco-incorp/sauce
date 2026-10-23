/**
 * Closure route bodies — `sauceBodyToSource` extraction + end-to-end through `compileSauceRoute`.
 */
import { compileProgram as compile } from "./helpers";
import * as acorn from "acorn";
import { isSauceClosure, sauceBodyToSource } from "../src/routes/closure.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;

function bytecodeOf(source: string): Uint8Array {
  const { bytecode } = compile(source);
  return bytecode[0]!;
}

describe("sauceBodyToSource: block body", () => {
  it("compiles to byte-identical bytecode as the equivalent hand-written string", () => {
    const closure = () => {
      const x = 1n;
      return x + 1n;
    };
    const extracted = sauceBodyToSource(closure);
    const hand = "function main() {\n  const x = 1n;\n  return x + 1n;\n}";
    expect(Array.from(bytecodeOf(extracted))).toEqual(Array.from(bytecodeOf(hand)));
  });
});

describe("sauceBodyToSource: concise body", () => {
  it("compiles to byte-identical bytecode as the equivalent hand-written string", () => {
    const closure = () => 42n;
    const extracted = sauceBodyToSource(closure);
    const hand = "function main() {\n  return 42n;\n}";
    expect(Array.from(bytecodeOf(extracted))).toEqual(Array.from(bytecodeOf(hand)));
  });
});

describe("sauceBodyToSource: naive-slicing hazards", () => {
  it("a '=>' inside a string literal does not confuse extraction", () => {
    const closure = () => {
      // Unused as a VALUE on purpose — its presence in the closure's SOURCE TEXT is the whole
      // subject of this test, so `_` is what marks it deliberate rather than dead.
      const _s = "a => b";
      return 1n;
    };
    const extracted = sauceBodyToSource(closure);
    expect(extracted).toContain('"a => b"');
    // still parses as ONE well-formed function body (proves the string wasn't mistaken for the arrow itself)
    expect(() => acorn.parse(extracted, { ecmaVersion: "latest" })).not.toThrow();
  });

  it("line and block comments survive verbatim", () => {
    const closure = () => {
      // a line comment
      /* a block comment */
      return 1n;
    };
    const extracted = sauceBodyToSource(closure);
    expect(extracted).toContain("a line comment");
    expect(extracted).toContain("a block comment");
  });

  it("a nested arrow inside the body is left untouched in the emitted text", () => {
    const closure = () => {
      const f = (a: bigint) => a;
      return f(1n);
    };
    const extracted = sauceBodyToSource(closure as unknown as () => unknown);
    expect(extracted).toContain("=>");
  });
});

describe("sauceBodyToSource: fail-closed", () => {
  it("throws for an async closure", () => {
    const closure = async () => 1n;
    expect(() => sauceBodyToSource(closure as unknown as () => unknown)).toThrow(/async/i);
  });

  it("throws for a generator closure", () => {
    function* gen() {
      yield 1n;
    }
    expect(() => sauceBodyToSource(gen as unknown as () => unknown)).toThrow(/generator/i);
  });

  it("throws for a closure with any parameter", () => {
    const closure = ((x: bigint) => x) as unknown as () => unknown;
    expect(() => sauceBodyToSource(closure)).toThrow(/parameter/i);
  });

  it("throws for a native function", () => {
    expect(() => sauceBodyToSource(Math.max as unknown as () => unknown)).toThrow(/native code/i);
  });
});

describe("isSauceClosure", () => {
  it("distinguishes a function from a string", () => {
    expect(isSauceClosure(() => 1n)).toBe(true);
    expect(isSauceClosure("return 1n;")).toBe(false);
  });
});

describe("closure bodies end to end", () => {
  const execution = { pot: POT, engine: ENGINE };

  it("a closure compiles to the same route as its program written out", () => {
    const viaClosure = compileSauceRoute(
      "ethereum",
      sauceBodyToSource(() => {
        return 1n;
      }),
      execution,
    );
    const viaString = compileSauceRoute("ethereum", "function main(){ return 1n; }", execution);
    expect(viaClosure.calls).toEqual(viaString.calls);
  });

  it("a compile()-level define resolves a free identifier that would otherwise be a capture", () => {
    const built = compileSauceRoute(
      "ethereum",
      sauceBodyToSource(() => {
        return chainId;
      }),
      execution,
      { defines: { chainId: 1n } },
    );
    expect(built.calls).toHaveLength(1);
  });
});

describe("a closure's own helper functions", () => {
  // A closure is the only place a closure-based program can declare a helper. SauceScript has no
  // nested functions, so the extracted program declares each at the top level, beside `main`.
  const withHelper = () => {
    function half(x: bigint): bigint {
      return x / 2n;
    }
    USDC.transfer(RECIPIENT, half(1000n));
  };
  const execution = { pot: POT, engine: ENGINE };

  it("are declared beside `main`, not inside it", () => {
    const source = sauceBodyToSource(withHelper);
    const main = source.indexOf("function main()");

    expect(source.indexOf("function half(")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("function half(")).toBeLessThan(main);
    expect(source.slice(main)).not.toContain("function half(");
  });

  it("are cut out wherever they stand, and keep calling each other", () => {
    // Interleaved with the statements, one calling the other: each comes out whole, and the body
    // keeps every statement, in order. A closure's text is the host's compiled JavaScript, so its
    // helpers carry no annotations by the time the SDK reads them.
    const interleaved = () => {
      const start = 1000n;
      function quarter(x: bigint): bigint {
        return half(half(x));
      }
      USDC.transfer(RECIPIENT, quarter(start));
      function half(x: bigint): bigint {
        return x / 2n;
      }
      USDC.transfer(RECIPIENT, half(start));
    };
    const source = sauceBodyToSource(interleaved);
    const main = source.slice(source.indexOf("function main()"));

    expect(source.indexOf("function quarter(")).toBeLessThan(source.indexOf("function half("));
    expect(source.indexOf("function half(")).toBeLessThan(source.indexOf("function main()"));
    expect(main.slice("function main()".length)).not.toContain("function ");
    expect(main.indexOf("const start = 1000n;")).toBeLessThan(main.indexOf("quarter(start)"));
    expect(main.indexOf("quarter(start)")).toBeLessThan(main.indexOf("half(start)"));
    // The same program a hand-written source makes.
    const options = { defines: { RECIPIENT: 0x99n } };
    const written = `function quarter(x) { return half(half(x)); }
function half(x) { return x / 2n; }
function main() {
  const start = 1000n;
  USDC.transfer(RECIPIENT, quarter(start));
  USDC.transfer(RECIPIENT, half(start));
}`;
    expect(
      Array.from(compileSauceRoute("base", source, execution, options).compiled.bytecode[0]!),
    ).toEqual(
      Array.from(compileSauceRoute("base", written, execution, options).compiled.bytecode[0]!),
    );
  });

  it("compile", () => {
    const out = compileSauceRoute("base", sauceBodyToSource(withHelper), execution, {
      defines: { RECIPIENT: 0x99n },
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

// Ambient declared only for the type-checker inside the closure fixtures above -- the compiler
// resolves them via `options.defines` or the route rewrites, never via JS scope (closures capture
// nothing).
declare const chainId: bigint;
declare const RECIPIENT: bigint;
