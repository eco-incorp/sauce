/**
 * `available(<name>)`: one program that uses a venue only on the chains that have it. The check is
 * decided at compile time for the chain the program is compiled for, and the branch it rules out is
 * removed from the source before any name in it resolves — the compiler itself would still resolve
 * a dead branch's names, so without this a program naming PancakeSwap V3 could not compile for a
 * chain without it at all. See `src/routes/available.ts`.
 */
import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { rewriteAvailability } from "../src/routes/available.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { resolveTokenMap } from "../src/routes/token-registry.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
} as const;

/** Compiles `body` (a `main` body) for `chain`, returning the source as compiled and the bytecode. */
function build(chain: string, body: string, tokens?: Record<string, `0x${string}`>) {
  const compiled = compileSauceRoute(chain, `function main() {\n${body}\n}`, EXECUTION, {
    tokens,
  });
  return { source: compiled.source, bytecode: compiled.compiled.bytecode[0]! };
}

/** `decided` compiles, on `chain`, to exactly the program that is only the branch it takes. */
function same(
  chain: string,
  decided: string,
  taken: string,
  tokens?: Record<string, `0x${string}`>,
): void {
  expect(Array.from(build(chain, decided, tokens).bytecode)).toEqual(
    Array.from(build(chain, taken, tokens).bytecode),
  );
}

/** The one source that runs everywhere: PancakeSwap V3 where it is deployed, else nothing. */
const VENUE = `
  let pool = 0n;
  if (available(PancakeswapV3.Factory)) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
  }
  return pool;
`;

describe("available(): one program, the venue only where the chain has it", () => {
  it("the registry agrees with the premise: PancakeSwap V3 is on Base and not on Optimism", () => {
    const factory = getDescriptor("pancakeswap-v3", "Factory")!;
    expect(factory.chains).toContain("base");
    expect(factory.chains).not.toContain("optimism");
  });

  it("keeps the branch on a chain with the contract: Base calls its factory", () => {
    same(
      "base",
      VENUE,
      "let pool = 0n;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
    );
  });

  it("folds the branch out on a chain without it: Optimism compiles to the program without it", () => {
    const folded = build("optimism", VENUE);
    const without = build("optimism", "let pool = 0n;\nreturn pool;");
    expect(Array.from(folded.bytecode)).toEqual(Array.from(without.bytecode));
  });

  it("control: the same branch without available() does not compile on Optimism", () => {
    expect(() =>
      build("optimism", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"),
    ).toThrow(/not deployed on 'optimism'/);
  });

  it("an else-if chain takes the first venue the chain has", () => {
    const ladder = `
      let pool = 0n;
      if (available(PancakeswapV3.Factory)) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
      } else if (available(UniswapV3.Factory)) {
        pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
      }
      return pool;
    `;
    same(
      "base",
      ladder,
      "let pool = 0n;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
    );
    same(
      "optimism",
      ladder,
      "let pool = 0n;\npool = UniswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
    );
  });

  it("a guard that returns early removes the rest of its block on a chain without the contract", () => {
    const guard = `
      if (!available(PancakeswapV3.Factory)) {
        return 0n;
      }
      return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
    `;
    same("base", guard, "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);");
    same("optimism", guard, "return 0n;");
  });

  it("?:, && and || fold the same way", () => {
    same(
      "optimism",
      "return available(PancakeswapV3.Factory) ? PancakeswapV3.Factory.getPool(USDC, WETH, 500n) : 7n;",
      "return 7n;",
    );
    same(
      "optimism",
      "if (available(PancakeswapV3.Factory) && PancakeswapV3.Factory.getPool(USDC, WETH, 500n) > 0n) { return 1n; }\nreturn 0n;",
      "if (false) { return 1n; }\nreturn 0n;",
    );
    same(
      "base",
      "if (!available(PancakeswapV3.Factory) || PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      // The decided operand is gone: what `||` is left with is the right operand.
      "if (PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
    );
  });

  it("anywhere else it is the literal, and a branch behind a runtime value stays live code", () => {
    same(
      "optimism",
      "const has = available(UniswapV3.Factory);\nreturn has;",
      "const has = true;\nreturn has;",
    );
    expect(() =>
      build(
        "optimism",
        "const has = available(PancakeswapV3.Factory);\nif (has) { return PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }\nreturn 0n;",
      ),
    ).toThrow(/not deployed on 'optimism'/);
  });
});

describe("available(): what it can name", () => {
  it("a token symbol, by the chain's token map: the registry and the caller's tokens", () => {
    const usdt = "return available(USDT) ? USDT.balanceOf(ctx.self()) : 0n;";
    same("ethereum", usdt, "return USDT.balanceOf(ctx.self());");
    same("base", usdt, "return 0n;");
    same("base", usdt, "return USDT.balanceOf(ctx.self());", {
      USDT: "0x2222222222222222222222222222222222222222",
    });
  });

  it("a family member and a chain-qualified contract", () => {
    const base = requireChain("base");
    const tokens = resolveTokenMap(base);
    expect(
      rewriteAvailability("const a = available(Uniswap.UniversalRouter);", base, tokens).source,
    ).toBe("const a = true;");
    // Named on another chain, the check is that chain's, whatever the program is compiled for.
    expect(
      rewriteAvailability("const a = available(Optimism.PancakeswapV3.Factory);", base, tokens)
        .source,
    ).toBe("const a = false;");
  });

  it("on an svm chain no EVM contract is available", () => {
    const solana = requireChain("solana");
    expect(
      rewriteAvailability(
        "const a = available(UniswapV3.Factory);",
        solana,
        resolveTokenMap(solana),
      ).source,
    ).toBe("const a = false;");
  });

  it.each([
    [
      "a contract the protocol does not have",
      "available(UniswapV3.Factroy)",
      /Unknown contract 'Factroy'/,
    ],
    [
      "a symbol no chain registers",
      "available(USDX)",
      /'USDX' is not a contract or token in the registry/,
    ],
    [
      "a namespace no registry protocol has",
      "available(Nope.Factory)",
      /'Nope.Factory' is not a contract or token/,
    ],
    [
      "a protocol without a contract",
      "available(UniswapV3)",
      /names a protocol; name one of its contracts/,
    ],
    ["an ambiguous family name", "available(Uniswap.Factory)", /ambiguous under Uniswap/],
    ["an interface", "available(Erc4626.Vault)", /is an interface — no chain deploys it/],
    ["an expression", "available(1n)", /takes a registry name/],
  ])("fails closed on %s, even in a branch it would remove", (_what, call, error) => {
    const base = requireChain("base");
    expect(() =>
      rewriteAvailability(`if (false) { const a = ${call}; }`, base, resolveTokenMap(base)),
    ).toThrow(error);
  });

  it("a program that declares its own available keeps it", () => {
    const base = requireChain("base");
    const source = "function available(x) { return x; }\nconst a = available(UniswapV3.Factory);";
    expect(rewriteAvailability(source, base, resolveTokenMap(base))).toEqual({
      source,
      rewrote: false,
      sites: 0,
    });
  });

  it("a closure body is left for its own chain's compile", () => {
    const base = requireChain("base");
    const source =
      "Optimism(() => { if (available(PancakeswapV3.Factory)) { f(); } });\nconst a = available(PancakeswapV3.Factory);";
    expect(rewriteAvailability(source, base, resolveTokenMap(base)).source).toBe(
      "Optimism(() => { if (available(PancakeswapV3.Factory)) { f(); } });\nconst a = true;",
    );
  });
});
