/**
 * A name used as a token or a protocol that the destination does not have is reported as that, at
 * the name.
 *
 * `DAIX.balanceOf(x)` names nothing on Base: `DAIX` is not a registered token, a protocol, a
 * declaration or a builtin. The compiler reads every name the chain has from the extensions manifest
 * (`src/routes/extensions.ts`), so it reports an unknown one itself, located in the source as
 * written; and a token or contract the chain lacks but another chain has carries the manifest's
 * message saying where it is.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;

const compileOn = (chain: string, source: string, options = {}) =>
  compileSauceRoute(chain, source, EXECUTION, options);

/** The refusal of `source` on `chain`: its last located message, and the text that message covers. */
function refusal(chain: string, source: string): { message: string; covers: string } {
  try {
    compileOn(chain, source);
  } catch (error) {
    const located = (
      error as {
        diagnostics?: { message: string; start: { offset: number }; end: { offset: number } }[];
      }
    ).diagnostics?.at(-1);
    if (located === undefined) throw error;
    return {
      message: located.message,
      covers: source.slice(located.start.offset, located.end.offset),
    };
  }
  throw new Error(`\`${source}\` compiled`);
}

describe("an unknown token or protocol name", () => {
  it("is named where it is written", () => {
    expect(refusal("base", "function main() { return DAIX.balanceOf(ctx.self()); }")).toEqual({
      message: "`DAIX` is not a declared variable",
      covers: "DAIX",
    });
    expect(
      refusal("base", `function main() { Uniswapp.UniversalRouter.execute("0x0a", ["0x00"], 1n); }`)
        .covers,
    ).toBe("Uniswapp");
  });

  it("is reported in value position too", () => {
    expect(
      refusal("base", "function main() { USDC.approve(Uniswapp.UniversalRouter, 1n); }").covers,
    ).toBe("Uniswapp");
  });

  it("a token the chain lacks says which chains have it: Optimism has USDT, Base does not", () => {
    const { message, covers } = refusal(
      "base",
      "function main() { return USDT.balanceOf(ctx.self()); }",
    );
    expect(message).toMatch(
      /^`USDT` is not a token base registers; it is registered on: .*optimism/,
    );
    expect(covers).toBe("USDT");
    expect(() =>
      compileOn("optimism", "function main() { return USDT.balanceOf(ctx.self()); }"),
    ).not.toThrow();
  });
});

describe("a name the program or the compile gives meaning to is not unknown", () => {
  it.each([
    ["a local", "function main(): Uint256 { const xs = [1n, 2n]; return xs.length; }"],
    ["a parameter", "function main(input: bytes): bytes { return input.slice(0n, 4n); }"],
    ["a builtin", "function main(): Uint256 { return Math.sqrt(ctx.timestamp()); }"],
    ["a registry token", "function main(): Uint256 { return USDC.balanceOf(ctx.self()); }"],
    ["a protocol", `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 1n); }`],
    [
      "an import",
      'import ISauceRouter from "./artifacts/ISauceRouter.json";\nfunction main() { ISauceRouter.at(ctx.self()); }',
    ],
    ["the `self` sugar", "function main(): Uint256 { return self.USDC; }"],
  ])("%s", (_name, source) => {
    expect(() => compileOn("base", source)).not.toThrow(/is not a declared variable/);
  });

  it("a constant an ambient module exports", () => {
    // An ambient module broadcasts its exports with no import, so nothing in the program declares
    // `CFG`; only the compiler knows the name. A program it compiles is never refused here.
    const lib = new TextEncoder().encode("export const CFG = { fee: 30n };");
    const out = compileOn("base", "function main(): Uint256 { return CFG.fee; }", {
      ambient: ["./lib.ts"],
      resolve: (path: string) => (path === "./lib.ts" ? lib : undefined),
    });

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a contract binding the caller supplies", () => {
    const abi = [
      {
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const;
    const out = compileOn(
      "base",
      "function main(): Uint256 { return ERC20.view(ctx.self()).totalSupply(); }",
      { contracts: { ERC20: { abi } } },
    );

    expect(out.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});
