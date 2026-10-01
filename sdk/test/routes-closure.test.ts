/**
 * Closure route bodies: a closure's own `Function.prototype.toString()` text, compiled by the
 * compiler as the entry (`entryKind: "closure"`), with nothing parsed, sliced or wrapped by the SDK.
 */
import { closureSource, isSauceClosure } from "../src/routes/closure.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceRoute, type SauceCompileOptions } from "../src/routes/sauce-route.js";
import type { IntentOptions } from "../src/routes/intent-dsl.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const execution = { pot: POT, engine: ENGINE };

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

/** The bytecode of a closure body, as the compiler reads its text. */
function closureBytecode(body: () => unknown, options: SauceCompileOptions = {}): number[] {
  return Array.from(
    compileSauceRoute("base", closureSource(body), execution, { ...options, entryKind: "closure" })
      .compiled.bytecode[0]!,
  );
}

/** The bytecode of a module source. */
function moduleBytecode(source: string, options: SauceCompileOptions = {}): number[] {
  return Array.from(compileSauceRoute("base", source, execution, options).compiled.bytecode[0]!);
}

describe("a closure compiles as the program its text is", () => {
  it("a block body is main's body", () => {
    const closure = () => {
      const x = 1n;
      return x + 1n;
    };
    expect(closureBytecode(closure)).toEqual(
      moduleBytecode("function main() {\n  const x = 1n;\n  return x + 1n;\n}"),
    );
  });

  it("a concise body is main's return", () => {
    expect(closureBytecode(() => 42n)).toEqual(
      moduleBytecode("function main() {\n  return 42n;\n}"),
    );
  });

  it("text that merely looks like syntax is left alone: a `=>` in a string, comments", () => {
    const closure = () => {
      // a line comment } =>
      /* a block comment { */
      const s = "a => { b";
      return s.length;
    };
    expect(closureBytecode(closure)).toEqual(
      moduleBytecode('function main() { const s = "a => { b"; return s.length; }'),
    );
  });

  it("the text reaches the compiler as written", () => {
    const closure = () => 1n;
    const out = compileSauceRoute("base", closureSource(closure), execution, {
      entryKind: "closure",
    });
    expect(out.source).toBe(Function.prototype.toString.call(closure));
  });
});

describe("what a closure cannot be", () => {
  it("async", () => {
    const closure = async () => 1n;
    expect(() => closureBytecode(closure as unknown as () => unknown)).toThrow(/async/i);
  });

  it("a generator", () => {
    function* gen() {
      yield 1n;
    }
    expect(() => closureBytecode(gen as unknown as () => unknown)).toThrow(/generator/i);
  });

  it("one with a parameter: a route is called with no arguments", () => {
    const closure = ((x: bigint) => x) as unknown as () => unknown;
    expect(() => closureSource(closure)).toThrow(/parameter/i);
  });

  it("a native function, whose text the runtime does not have", () => {
    expect(() => closureSource(Math.max as unknown as () => unknown)).toThrow(/native code/i);
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
  // nested functions, so the compiler declares each a module function, beside `main`.
  const withHelper = () => {
    function half(x: bigint): bigint {
      return x / 2n;
    }
    USDC.transfer(RECIPIENT, half(1000n));
  };
  const options = { defines: { RECIPIENT: 0x99n } };

  it("are module functions, wherever they stand, and keep calling each other", () => {
    // Interleaved with the statements, one calling the other. A closure's text is the host's
    // compiled JavaScript, so its helpers carry no annotations by the time the compiler reads them.
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
    const written = `function quarter(x) { return half(half(x)); }
function half(x) { return x / 2n; }
function main() {
  const start = 1000n;
  USDC.transfer(RECIPIENT, quarter(start));
  USDC.transfer(RECIPIENT, half(start));
}`;
    expect(closureBytecode(interleaved, options)).toEqual(moduleBytecode(written, options));
  });

  it("compile", () => {
    expect(closureBytecode(withHelper, options).length).toBeGreaterThan(0);
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
    const out = closureBytecode(body, {
      ...options,
      intents: {
        deadline: 4_000_000_000n,
        creator: "0x3333333333333333333333333333333333333333",
        executionFee: 0n,
      },
    });

    expect(out.length).toBeGreaterThan(0);
  });
});

// Ambient declared only for the type-checker inside the closure fixtures above -- the compiler
// resolves them via `options.defines` or the route rewrites, never via JS scope (closures capture
// nothing).
declare const chainId: bigint;
declare const RECIPIENT: bigint;
declare const Arbitrum: (body: () => void) => { reward(spec: unknown): void };
