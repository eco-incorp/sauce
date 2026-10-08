/**
 * Closure route bodies: the closure's own text is the compiler's `"closure"` entry, as it stands —
 * nothing extracts, wraps or cuts it — and as a route end to end.
 */
import { closureText, isSauceClosure } from "../src/routes/closure.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import type { SauceIntentChain } from "../src/routes/source-globals.generated.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const execution = { pot: POT, engine: ENGINE };

const bytecodeOf = (body: string | (() => unknown), options = {}): number[] =>
  Array.from(compileSauceRoute("base", body, execution, options).compiled.bytecode[0]!);

describe("a closure body is its own text, compiled as the entry", () => {
  it("a block body compiles to the bytecode of the equivalent hand-written `main`", () => {
    const closure = () => {
      const x = 1n;
      return x + 1n;
    };
    expect(bytecodeOf(closure)).toEqual(
      bytecodeOf("function main() {\n  const x = 1n;\n  return x + 1n;\n}"),
    );
  });

  it("a concise body is `main`'s return", () => {
    expect(bytecodeOf(() => 42n)).toEqual(bytecodeOf("function main() {\n  return 42n;\n}"));
  });

  it("comments and a `=>` inside them reach the compiler as they stand", () => {
    const closure = () => {
      // a line comment, with a => in it
      /* a block comment */
      return 1n;
    };
    expect(closureText(closure)).toContain("a line comment, with a => in it");
    expect(bytecodeOf(closure)).toEqual(bytecodeOf("function main() { return 1n; }"));
  });
});

describe("a closure the compiler refuses", () => {
  it("an async closure", () => {
    const closure = async () => 1n;
    expect(() => bytecodeOf(closure as unknown as () => unknown)).toThrow(/async/i);
  });

  it("a native function, whose text is not its code", () => {
    expect(() => closureText(Math.max as unknown as () => unknown)).toThrow(/native code/i);
  });
});

describe("isSauceClosure", () => {
  it("distinguishes a function from a string", () => {
    expect(isSauceClosure(() => 1n)).toBe(true);
    expect(isSauceClosure("return 1n;")).toBe(false);
  });
});

describe("closure bodies as routes, end to end", () => {
  it("a genuine capture is refused, naming the free identifier", () => {
    const outer = 5n;
    expect(() =>
      compileSauceRoute(
        "ethereum",
        () => {
          return outer + 1n;
        },
        execution,
      ),
    ).toThrow(/outer/);
  });

  it("a closure compiles to the route its text written as a program compiles to", () => {
    const viaClosure = compileSauceRoute(
      "ethereum",
      () => {
        return 1n;
      },
      execution,
    );
    const viaString = compileSauceRoute("ethereum", "function main(){ return 1n; }", execution);
    expect(viaClosure.calls).toEqual(viaString.calls);
  });

  it("a define resolves a free identifier that would otherwise be a capture", () => {
    const route = compileSauceRoute(
      "ethereum",
      () => {
        return RECIPIENT;
      },
      execution,
      { defines: { RECIPIENT: 1n } },
    );
    expect(route.calls).toHaveLength(1);
  });
});

describe("a closure's own helper functions", () => {
  // A closure is the only place a closure-based program can declare a helper: a function declared
  // at the top of its block is a module function, beside `main`.
  const withHelper = () => {
    function half(x: bigint): bigint {
      return x / 2n;
    }
    USDC.transfer(RECIPIENT, half(1000n));
  };

  it("interleaved with the statements, one calling the other, compile as the hand-written module", () => {
    // A closure's text is the host's compiled JavaScript, so its helpers carry no annotations by the
    // time the SDK hands them over.
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
    const options = { defines: { RECIPIENT: 0x99n } };
    const written = `function quarter(x) { return half(half(x)); }
function half(x) { return x / 2n; }
function main() {
  const start = 1000n;
  USDC.transfer(RECIPIENT, quarter(start));
  USDC.transfer(RECIPIENT, half(start));
}`;
    expect(bytecodeOf(interleaved, options)).toEqual(bytecodeOf(written, options));
  });

  it("compile", () => {
    expect(bytecodeOf(withHelper, { defines: { RECIPIENT: 0x99n } }).length).toBeGreaterThan(0);
  });

  it("reach an intent opened inside the closure", () => {
    const body = () => {
      function half(x: bigint): bigint {
        return x / 2n;
      }
      const amount = USDC.balanceOf(0x1234n);
      Arbitrum.hop({
        send: [{ token: USDC, amount }],
        refundee: 0x3333333333333333333333333333333333333333n,
      }).then(() => {
        USDC.transfer(RECIPIENT, half(amount));
      });
    };
    const out = compileSauceRoute("base", body, execution, {
      defines: { RECIPIENT: 0x99n },
      intents: {
        deadline: 4_000_000_000n,
        executionFee: 0n,
      },
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

// Ambient declared only for the type-checker inside the closure fixtures above -- the compiler
// resolves them through the chain's module or `options.defines`, never via JS scope (closures
// capture nothing).
declare const RECIPIENT: bigint;
declare const Arbitrum: SauceIntentChain;
