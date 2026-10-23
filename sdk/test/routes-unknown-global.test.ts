/**
 * A name used as a token or a protocol that the destination does not have is reported as that.
 *
 * `DAIX.balanceOf(x)` names nothing on Base: `DAIX` is not a registered token, a protocol, a
 * declaration or a builtin. The token and protocol rewrites leave a name they do not know alone, so
 * it reached the compiler, which could only say "`this call expression` cannot be lowered to IR
 * yet". The route compiler knows what the chain has, so it says which name is unknown, on which
 * chain, and what it probably meant.
 */
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;

const compileOn = (chain: string, source: string, options = {}) =>
  compileSauceRoute(chain, source, EXECUTION, options);

describe("an unknown token or protocol name", () => {
  it("is named, with the chain", () => {
    expect(() =>
      compileOn("base", "function main() { return DAIX.balanceOf(ctx.self()); }"),
    ).toThrow("`DAIX` is not a token or protocol on base");
  });

  it("suggests the chain's near matches", () => {
    expect(() =>
      compileOn("base", "function main() { return USDCC.balanceOf(ctx.self()); }"),
    ).toThrow(/`USDCC` is not a token or protocol on base\. Did you mean `USDC`\?/);
    expect(() =>
      compileOn(
        "base",
        `function main() { Uniswapp.UniversalRouter.execute("0x0a", ["0x00"], 1n); }`,
      ),
    ).toThrow(/`Uniswapp` is not a token or protocol on base\. Did you mean `Uniswap`/);
  });

  it("suggests from the chain it compiles for: Optimism has USDT, Base does not", () => {
    expect(() =>
      compileOn("optimism", "function main() { return USDTT.balanceOf(ctx.self()); }"),
    ).toThrow(/Did you mean `USDT` or `USDT0`\?/);
    expect(() =>
      compileOn("base", "function main() { return USDTT.balanceOf(ctx.self()); }"),
    ).not.toThrow(/Did you mean `USDT`/);
  });

  it("is reported in value position too", () => {
    expect(() =>
      compileOn("base", "function main() { USDC.approve(Uniswapp.UniversalRouter, 1n); }"),
    ).toThrow("`Uniswapp` is not a token or protocol on base");
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
    ["the `pot` sugar", "function main(): Uint256 { return pot.USDC + pot.balance; }"],
  ])("%s", (_name, source) => {
    expect(() => compileOn("base", source)).not.toThrow(/is not a token or protocol/);
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
