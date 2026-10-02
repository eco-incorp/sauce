/**
 * `available(<name>)`: one program that uses a venue only on the chains that have it. It is the
 * comparison `0n != <name>` (`src/routes/available.ts`), which the compiler decides for the chain
 * the program is compiled for — a name the chain lacks is zero there — leaving out the branch it
 * rules out, names and all. So each case is held to the program written without the branch.
 */
import { getDescriptor } from "../src/descriptors/query.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
} as const;

/** `body`, a `main` returning a number, compiled for `chain`. */
function bytecode(chain: string, body: string, tokens?: Record<string, `0x${string}`>): number[] {
  const compiled = compileSauceRoute(chain, `function main(): Uint256 {\n${body}\n}`, EXECUTION, {
    tokens,
  });
  return Array.from(compiled.compiled.bytecode[0]!);
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

  it("keeps the branch on a chain with the contract, and leaves it out on one without", () => {
    expect(bytecode("base", VENUE)).toEqual(
      bytecode(
        "base",
        "let pool = 0n;\nif (true) { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }\nreturn pool;",
      ),
    );
    expect(bytecode("optimism", VENUE)).toEqual(
      bytecode("optimism", "let pool = 0n;\nreturn pool;"),
    );
  });

  it("control: the same branch without available() does not compile on Optimism", () => {
    expect(() =>
      bytecode("optimism", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"),
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
    expect(bytecode("base", ladder)).toEqual(
      bytecode(
        "base",
        "let pool = 0n;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
      ),
    );
    expect(bytecode("optimism", ladder)).toEqual(
      bytecode(
        "optimism",
        "let pool = 0n;\npool = UniswapV3.Factory.getPool(USDC, WETH, 500n);\nreturn pool;",
      ),
    );
  });

  it("a guard that returns early removes the rest of its block on a chain without the contract", () => {
    const guard = `
      if (!available(PancakeswapV3.Factory)) {
        return 0n;
      }
      return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
    `;
    expect(bytecode("base", guard)).toEqual(
      bytecode("base", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"),
    );
    expect(bytecode("optimism", guard)).toEqual(bytecode("optimism", "return 0n;"));
  });

  it("?:, && and || fold the same way", () => {
    expect(
      bytecode(
        "optimism",
        "return available(PancakeswapV3.Factory) ? PancakeswapV3.Factory.getPool(USDC, WETH, 500n) : 7n;",
      ),
    ).toEqual(bytecode("optimism", "return 7n;"));
    expect(
      bytecode(
        "optimism",
        "if (available(PancakeswapV3.Factory) && PancakeswapV3.Factory.getPool(USDC, WETH, 500n) > 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(bytecode("optimism", "return 0n;"));
    expect(
      bytecode(
        "base",
        "if (!available(PancakeswapV3.Factory) || PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(
      bytecode(
        "base",
        "if (PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    );
  });

  it("anywhere else it is a constant, and a branch behind a variable stays live code", () => {
    expect(
      bytecode("optimism", "const has = available(UniswapV3.Factory);\nreturn has ? 1n : 2n;"),
    ).toEqual(bytecode("optimism", "const has = true;\nreturn has ? 1n : 2n;"));
    expect(() =>
      bytecode(
        "optimism",
        "let has = available(PancakeswapV3.Factory);\nif (has) { return PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }\nreturn 0n;",
      ),
    ).toThrow(/not deployed on 'optimism'/);
  });
});

describe("available(): what it can name", () => {
  it("a token symbol, by the chain's token map: the registry and the caller's tokens", () => {
    const usdt = "return available(USDT) ? USDT.balanceOf(self) : 0n;";
    expect(bytecode("ethereum", usdt)).toEqual(
      bytecode("ethereum", "return USDT.balanceOf(self);"),
    );
    expect(bytecode("base", usdt)).toEqual(bytecode("base", "return 0n;"));
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    expect(bytecode("base", usdt, tokens)).toEqual(
      bytecode("base", "return USDT.balanceOf(self);", tokens),
    );
  });

  it("a family member and a chain-qualified contract", () => {
    expect(bytecode("base", "return available(Uniswap.UniversalRouter) ? 1n : 2n;")).toEqual(
      bytecode("base", "return 1n;"),
    );
    // Named on another chain, the check is that chain's, whatever the program is compiled for.
    expect(bytecode("base", "return available(Optimism.PancakeswapV3.Factory) ? 1n : 2n;")).toEqual(
      bytecode("base", "return 2n;"),
    );
  });

  it("on an svm chain no EVM contract is available", () => {
    const solana = (body: string) =>
      Array.from(compileSauceProgram("solana", `function main(): Uint256 { ${body} }`).bytecode);
    expect(solana("return available(UniswapV3.Factory) ? 1n : 2n;")).toEqual(solana("return 2n;"));
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
    expect(() => bytecode("base", `if (false) { const a = ${call}; }\nreturn 0n;`)).toThrow(error);
  });

  it("a program that declares its own available keeps it", () => {
    expect(
      Array.from(
        compileSauceProgram(
          "base",
          "function available(x: Uint256): Uint256 { return x + 1n; }\nfunction main(): Uint256 { return available(2n); }",
        ).bytecode,
      ),
    ).toEqual(
      Array.from(
        compileSauceProgram(
          "base",
          "function plus(x: Uint256): Uint256 { return x + 1n; }\nfunction main(): Uint256 { return plus(2n); }",
        ).bytecode,
      ),
    );
  });

  it("an intent's body decides it for its own chain", () => {
    const intents = {
      deadline: 4_000_000_000n,
      creator: "0x3333333333333333333333333333333333333333",
      executionFee: 0n,
    } as const;
    const program = (guarded: string) => `function main() {
  const amount = USDC.balanceOf(self);
  Optimism(() => {
    ${guarded}
  }).reward({ tokens: [{ token: USDC, amount }] });
}`;
    // PancakeSwap V3 is on Base, where the program is compiled, and not on Optimism, where the body
    // runs: the body's branch is left out, so its program never names the factory.
    expect(() =>
      compileSauceProgram(
        "base",
        program(
          "if (available(PancakeswapV3.Factory)) { PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }",
        ),
        { intents },
      ),
    ).not.toThrow();
    expect(() =>
      compileSauceProgram("base", program("PancakeswapV3.Factory.getPool(USDC, WETH, 500n);"), {
        intents,
      }),
    ).toThrow(/not deployed on 'optimism'/);
  });
});

/**
 * The bytes `available(...)` compiled to on `main`, where it was decided by a pass over the source,
 * before the compiler decided it: each program on a chain with the name and one without. Captured
 * from that build; the compiler's decision must not move a byte.
 */
const ON_MAIN: readonly { source: string; chain: string; bytecode: string }[] = [
  {
    source:
      "function main(a: Address, b: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory.getPool(a, b, 500n); } return 0n; }",
    chain: "base",
    bytecode:
      "a502009dd1514702000eb19000b6d002005d01209554e102007d0120955401001433128a8fc17869897dce68ed026d694621f6fdfd0201f4f1e3f1e3e4a00320202090041698ee829602a3a101149701208ae1d1890520000000003100",
  },
  {
    source:
      "function main(a: Address, b: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory.getPool(a, b, 500n); } return 0n; }",
    chain: "linea",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010001208ae1d1890520000000003100",
  },
  {
    source:
      "function main(): Uint256 { const both = available(USDT) && available(UniswapV3.Factory); return both ? 1n : 2n; }",
    chain: "ethereum",
    bytecode: "010101208ae1d1890520000000003100",
  },
  {
    source:
      "function main(): Uint256 { const both = available(USDT) && available(UniswapV3.Factory); return both ? 1n : 2n; }",
    chain: "base",
    bytecode: "010201208ae1d1890520000000003100",
  },
  {
    source:
      "function quote(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory)) { return 0n; } return PancakeswapV3.Factory.getPool(a, b, 500n); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1n; }",
    chain: "base",
    bytecode:
      "a50200acd1514702000eb19000b6d002006c01209554e102008c01209554020027f1f1020039b00101e12101208ae1d18905200000000031000100140bfbcf9fa4f9c56b0f40a671ad40e0805a0918650201f4f1e3f1e3e4a00320202090041698ee829602a3a1011497e1b0",
  },
  {
    source:
      "function quote(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory)) { return 0n; } return PancakeswapV3.Factory.getPool(a, b, 500n); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1n; }",
    chain: "optimism",
    bytecode:
      "a5020073d1514702000eb19000b6d002003301209554e002005301209554e001000101e12101208ae1d1890520000000003100",
  },
  {
    source:
      "function main(): Uint256 { if (available(Linea.UniswapV3.Factory)) { return 1n; } else { return 2n; } }",
    chain: "base",
    bytecode: "010201208ae1d1890520000000003100",
  },
];

describe("available(): the bytes it compiled to before the compiler decided it", () => {
  it.each(ON_MAIN.map((entry) => [`${entry.chain}: ${entry.source}`, entry] as const))(
    "%s",
    (_name, { source, chain, bytecode: expected }) => {
      expect(Buffer.from(compileSauceProgram(chain, source).bytecode).toString("hex")).toBe(
        expected,
      );
    },
  );
});
