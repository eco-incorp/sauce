/**
 * One program that uses a venue only on the chains that have it. A registry name a chain lacks is
 * declared there as the zero of its type, unusable: comparing it with zero is allowed, and the
 * compiler decides that comparison while compiling, so a branch it rules out is never compiled —
 * nothing in it resolves. Any other use is the chain's message, at the use. See `src/routes/host.ts`.
 */
import { getDescriptor } from "../src/descriptors/query.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
} as const;

/** Compiles `body` (a `main` body) for `chain`, returning the bytecode. */
function build(chain: string, body: string, tokens?: Record<string, `0x${string}`>): number[] {
  const compiled = compileSauceRoute(chain, `function main() {\n${body}\n}`, EXECUTION, {
    tokens,
  });
  return Array.from(compiled.compiled.bytecode[0]!);
}

/** The one source that runs everywhere: PancakeSwap V3 where it is deployed, else nothing. */
const VENUE = `
  let pool = 0n;
  if (PancakeswapV3.Factory != 0) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
  }
  return pool;
`;
const NOTHING = "let pool = 0n;\nreturn pool;";

describe("a name the chain lacks is zero: one program, the venue only where the chain has it", () => {
  it("the registry agrees with the premise: PancakeSwap V3 is on Base and not on Optimism", () => {
    const factory = getDescriptor("pancakeswap-v3", "Factory")!;
    expect(factory.chains).toContain("base");
    expect(factory.chains).not.toContain("optimism");
  });

  it("keeps the branch on a chain with the contract: Base calls its factory", () => {
    const address = getDescriptor("pancakeswap-v3", "Factory")!.perChainAddress[8453]!;
    const bytes = Buffer.from(build("base", VENUE)).toString("hex");
    expect(bytes).toContain(address.slice(2).toLowerCase());
    expect(build("base", VENUE)).not.toEqual(build("base", NOTHING));
  });

  it("drops the branch on a chain without it: Optimism compiles to the program without it", () => {
    expect(build("optimism", VENUE)).toEqual(build("optimism", NOTHING));
  });

  it("control: the same call unguarded is the chain's message, at the use", () => {
    expect(() =>
      build("optimism", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"),
    ).toThrow(/not deployed on 'optimism'/);
  });

  it("an else-if chain takes the first venue the chain has", () => {
    const ladder = `
      let pool = 0n;
      if (PancakeswapV3.Factory != 0) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
      } else if (UniswapV3.Factory != 0) {
        pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
      }
      return pool;
    `;
    expect(build("base", ladder)).toEqual(
      build(
        "base",
        "let pool = 0n;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
      ),
    );
    expect(build("optimism", ladder)).toEqual(
      build(
        "optimism",
        "let pool = 0n;\npool = UniswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
      ),
    );
  });

  it("a guard that returns early drops the rest of its block on a chain without the contract", () => {
    const guard = `
      if (PancakeswapV3.Factory == 0) {
        return 0n;
      }
      return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
    `;
    expect(build("base", guard)).toEqual(
      build("base", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"),
    );
    expect(build("optimism", guard)).toEqual(build("optimism", "return 0n;"));
  });

  it("?:, && and || decide the same way", () => {
    expect(
      build(
        "optimism",
        "return PancakeswapV3.Factory != 0 ? PancakeswapV3.Factory.getPool(USDC, WETH, 500n) : 7n;",
      ),
    ).toEqual(build("optimism", "return 7n;"));
    expect(
      build(
        "optimism",
        "if (PancakeswapV3.Factory != 0 && PancakeswapV3.Factory.getPool(USDC, WETH, 500n) > 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(build("optimism", "return 0n;"));
    expect(
      build(
        "base",
        "if (PancakeswapV3.Factory == 0 || PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(
      build(
        "base",
        "if (false || PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    );
  });

  it("the comparison is a value too, decided wherever it is used", () => {
    expect(build("optimism", "const has = UniswapV3.Factory != 0;\nreturn has;")).toEqual(
      build("optimism", "const has = true;\nreturn has;"),
    );
  });
});

describe("what a chain can lack", () => {
  it("a token symbol, by the chain's token map: the registry and the caller's tokens", () => {
    const usdt = "return USDT != 0 ? USDT.balanceOf(ctx.self()) : 0n;";
    expect(build("ethereum", usdt)).not.toEqual(build("ethereum", "return 0n;"));
    expect(build("base", usdt)).toEqual(build("base", "return 0n;"));
    expect(build("base", usdt, { USDT: "0x2222222222222222222222222222222222222222" })).not.toEqual(
      build("base", "return 0n;"),
    );
  });

  it("a family member and a chain-qualified contract", () => {
    expect(build("base", "return Uniswap.UniversalRouter != 0;")).toEqual(
      build("base", "return true;"),
    );
    // Named on another chain, the check is that chain's, whatever the program is compiled for.
    expect(build("base", "return Optimism.PancakeswapV3.Factory != 0;")).toEqual(
      build("base", "return false;"),
    );
  });

  it("on an svm chain no EVM contract is there", () => {
    const solana = (body: string) =>
      Array.from(compileSauceProgram("solana", `function main() {\n${body}\n}`).bytecode);
    expect(solana("return UniswapV3.Factory != 0;")).toEqual(solana("return false;"));
  });

  it.each([
    ["a contract the protocol does not have", "UniswapV3.Factroy != 0", /names no single contract/],
    ["a symbol no chain registers", "USDX != 0", /USDX/],
    ["a namespace no registry protocol has", "Nope.Factory != 0", /Nope/],
    ["a protocol with several contracts", "UniswapV3 != 0", /names no single contract/],
    ["an ambiguous family name", "Uniswap.Factory != 0", /ambiguous under Uniswap/],
    ["an interface, which no chain deploys", "Erc4626.Vault != 0", /no address of its own/],
  ])("refuses %s where it is compiled", (_what, check, error) => {
    expect(() => build("base", `return ${check};`)).toThrow(error);
  });

  it("a name the program binds is its own, and never asked about", () => {
    expect(build("base", "const USDC = 5n;\nreturn USDC;")).toEqual(build("base", "return 5n;"));
  });
});
