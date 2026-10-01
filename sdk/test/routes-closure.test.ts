/**
 * Closure route bodies — `sauceBodyToSource` extraction + end-to-end via `openRoute`.
 */
import { compileProgram as compile } from "./helpers";
import * as acorn from "acorn";
import { isSauceClosure, sauceBodyToSource } from "../src/routes/closure.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import type { IntentOptions } from "../src/routes/intent-dsl.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

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

describe("openRoute: closure bodies end to end", () => {
  it("a genuine capture throws the WRAPPED capture error naming the free identifier", () => {
    const outer = 5n;
    expect(() =>
      openRoute(
        "ethereum",
        () => {
          return outer + 1n;
        },
        evmOptions(),
      ),
    ).toThrow(/outer/);
    expect(() =>
      openRoute(
        "ethereum",
        () => {
          return outer + 1n;
        },
        evmOptions(),
      ),
    ).toThrow(/defines/);
  });

  it("Base(() => { return 1n; }, opts).reward(...) equals Base('function main(){ return 1n; }', opts).reward(...) at the Intent level", () => {
    const viaClosure = openRoute(
      "ethereum",
      () => {
        return 1n;
      },
      evmOptions(),
    ).reward(0n);
    const viaString = openRoute("ethereum", "function main(){ return 1n; }", evmOptions()).reward(
      0n,
    );
    expect(viaClosure.intent).toEqual(viaString.intent);
  });

  it("a compile()-level define resolves a free identifier that would otherwise be a capture", () => {
    const built = openRoute(
      "ethereum",
      () => {
        return chainId;
      },
      evmOptions({ compile: { defines: { chainId: 1n } } }),
    ).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
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

  it("compile", () => {
    const out = compileSauceRoute("base", sauceBodyToSource(withHelper), execution, {
      defines: { RECIPIENT: 0x99n },
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("reach an intent opened inside the closure", () => {
    const body = () => {
      function half(x: bigint): bigint {
        return x / 2n;
      }
      const amount = USDC.balanceOf(0x1234n);
      Arbitrum(() => {
        USDC.transfer(RECIPIENT, half(amount));
      }).reward({ tokens: [{ token: USDC, amount }] });
    };
    const out = compileSauceRoute("base", sauceBodyToSource(body), execution, {
      defines: { RECIPIENT: 0x99n },
      intents: {
        deadline: 4_000_000_000n,
        creator: "0x3333333333333333333333333333333333333333",
        executionFee: 0n,
      },
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

// Ambient declared only for the type-checker inside the closure fixtures above -- the compiler
// resolves them via `options.defines` or the route rewrites, never via JS scope (closures capture
// nothing).
declare const chainId: bigint;
declare const RECIPIENT: bigint;
declare const Arbitrum: (body: () => void) => { reward(spec: unknown): void };
