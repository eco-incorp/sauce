/**
 * One program that uses a venue only on the chains that have it. Every registry name is declared on
 * every chain (`routes/chain-module.ts`), and one the chain lacks is `undefined` there: testing it is
 * decided while compiling, so a branch it rules out is never compiled — nothing in it resolves. Any
 * other use is the compiler's error, at the use, naming it. A name no chain has is an error on every
 * chain.
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

const UNDEFINED = /is `undefined`|has no run-time value here/;

/** The one source that runs everywhere: PancakeSwap V3 where it is deployed, else nothing. */
const VENUE = `
  let pool = 0;
  if (PancakeswapV3.Factory) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
`;
const NOTHING = "let pool = 0;\nreturn pool;";

describe("a name the chain lacks is undefined: one program, the venue only where the chain has it", () => {
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

  it("control: the same value unguarded is the compiler's error, at the use", () => {
    expect(() => build("optimism", "return PancakeswapV3.Factory;")).toThrow(UNDEFINED);
  });

  it("an else-if chain takes the first venue the chain has", () => {
    const ladder = `
      let pool = 0;
      if (PancakeswapV3.Factory) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
      } else if (UniswapV3.Factory) {
        pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
      }
      return pool;
    `;
    expect(build("base", ladder)).toEqual(
      build(
        "base",
        "let pool = 0;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);\nreturn pool;",
      ),
    );
    expect(build("optimism", ladder)).toEqual(
      build(
        "optimism",
        "let pool = 0;\npool = UniswapV3.Factory.getPool(USDC, WETH, 500);\nreturn pool;",
      ),
    );
  });

  it("a guard that returns early drops the rest of its block on a chain without the contract", () => {
    const guard = `
      if (!PancakeswapV3.Factory) {
        return 0;
      }
      return PancakeswapV3.Factory.getPool(USDC, WETH, 500);
    `;
    expect(build("base", guard)).toEqual(
      build("base", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500);"),
    );
    expect(build("optimism", guard)).toEqual(build("optimism", "return 0;"));
  });

  it("?:, && and || decide the same way", () => {
    expect(
      build(
        "optimism",
        "return PancakeswapV3.Factory ? PancakeswapV3.Factory.getPool(USDC, WETH, 500) : 7;",
      ),
    ).toEqual(build("optimism", "return 7;"));
    expect(
      build(
        "optimism",
        "if (PancakeswapV3.Factory && PancakeswapV3.Factory.getPool(USDC, WETH, 500) > 0) { return 1; }\nreturn 0;",
      ),
    ).toEqual(build("optimism", "return 0;"));
    expect(
      build(
        "base",
        "if (!PancakeswapV3.Factory || PancakeswapV3.Factory.getPool(USDC, WETH, 500) == 0) { return 1; }\nreturn 0;",
      ),
    ).toEqual(
      build(
        "base",
        "if (PancakeswapV3.Factory.getPool(USDC, WETH, 500) == 0) { return 1; }\nreturn 0;",
      ),
    );
  });

  it("require(X) makes the program compile only for chains with it, at no cost", () => {
    const call = "return UniswapV3.Factory.getPool(USDC, WETH, 500);";
    expect(build("base", `require(UniswapV3.Factory, "no factory");\n${call}`)).toEqual(
      build("base", call),
    );
    expect(() => build("linea", 'require(UniswapV3.Factory, "no factory");\nreturn 0;')).toThrow(
      UNDEFINED,
    );
  });

  it("undefined is not 0: a comparison with zero keeps its branch, which then fails", () => {
    expect(() =>
      build(
        "optimism",
        "if (PancakeswapV3.Factory != 0) { return PancakeswapV3.Factory.getPool(USDC, WETH, 500); }\nreturn 0;",
      ),
    ).toThrow();
  });
});

describe("what a chain can lack", () => {
  it("a token symbol: one the chain lacks is undefined, so a test decides it", () => {
    const usdt = "return USDT ? USDT.balanceOf(self) : 0;";
    expect(build("ethereum", usdt)).toEqual(build("ethereum", "return USDT.balanceOf(self);"));
    expect(build("base", usdt)).toEqual(build("base", "return 0;"));
    expect(() => build("base", "return USDT.balanceOf(self);")).toThrow();
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    expect(build("base", usdt, tokens)).toEqual(
      build("base", "return USDT.balanceOf(self);", tokens),
    );
  });

  it("self.<symbol> is undefined where the chain lacks the token", () => {
    expect(build("base", "return self.USDT ? self.USDT : 0;")).toEqual(build("base", "return 0;"));
  });

  it("a family member and a chain-qualified contract", () => {
    expect(build("base", "return Uniswap.UniversalRouter ? 1 : 2;")).toEqual(
      build("base", "return 1;"),
    );
    // Named on another chain, the test is that chain's, whatever the program is compiled for.
    expect(build("base", "return Optimism.PancakeswapV3.Factory ? 1 : 2;")).toEqual(
      build("base", "return 2;"),
    );
    expect(build("optimism", "return Base.PancakeswapV3.Factory ? 1 : 2;")).toEqual(
      build("optimism", "return 1;"),
    );
  });

  it("on an svm chain no EVM contract is there", () => {
    const solana = (body: string) =>
      Array.from(compileSauceProgram("solana", `function main() {\n${body}\n}`).bytecode);
    expect(solana("return UniswapV3.Factory ? 1 : 2;")).toEqual(solana("return 2;"));
  });

  it("an interface is on every EVM chain: an ABI the program calls at an address", () => {
    expect(build("base", "return Erc4626.Vault ? 1 : 2;")).toEqual(build("base", "return 1;"));
  });

  it.each([
    ["a symbol no chain registers", "USDX ? 1 : 2", /USDX/],
    ["a namespace no registry protocol has", "Nope.Factory ? 1 : 2", /Nope/],
  ])("refuses %s on every chain", (_what, check, error) => {
    expect(() => build("base", `return ${check};`)).toThrow(error);
    expect(() => build("ethereum", `return ${check};`)).toThrow(error);
  });

  // A member a module value does not declare is an error, in a test too.
  it.each([
    ["a contract the protocol does not have", "UniswapV3.Factroy ? 1 : 2", /Factroy/],
    ["an ambiguous family name", "Uniswap.Factory ? 1 : 2", /Factory/],
  ])("refuses %s on every chain", (_what, check, error) => {
    expect(() => build("base", `return ${check};`)).toThrow(error);
  });

  it("a protocol with several contracts names no single one", () => {
    expect(() => build("base", "return UniswapV3 + 0;")).toThrow(/names no single contract/);
  });

  it("an intent's body decides it for its own chain", () => {
    const intents = { deadline: 4_000_000_000n, executionFee: 0n } as const;
    const program = (guarded: string) => `function main() {
  const amount = USDC.balanceOf(self);
  Optimism.hop({ send: [{ token: USDC, amount }], refundee: 0x3333333333333333333333333333333333333333 }).then(() => {
    ${guarded}
  });
}`;
    // PancakeSwap V3 is on Base, where the program is compiled, and not on Optimism, where the body
    // runs: the body's branch is left out, so its program never names the factory.
    expect(() =>
      compileSauceProgram(
        "base",
        program("if (PancakeswapV3.Factory) { PancakeswapV3.Factory.getPool(USDC, WETH, 500); }"),
        { intents },
      ),
    ).not.toThrow();
    expect(() =>
      compileSauceProgram("base", program("PancakeswapV3.Factory.getPool(USDC, WETH, 500);"), {
        intents,
      }),
    ).toThrow();
  });

  it("a name the program binds is its own", () => {
    expect(build("base", "const USDC = 5;\nreturn USDC;")).toEqual(build("base", "return 5;"));
  });
});

describe("available(X) is gone", () => {
  it("calling it says to test the name itself", () => {
    expect(() => build("base", "return available(UniswapV3.Factory) ? 1 : 2;")).toThrow(
      /`available\(X\)` is removed: test the name itself, `if \(X\)`/,
    );
  });

  it("a program that declares its own available keeps it", () => {
    const own = (name: string) =>
      Array.from(
        compileSauceProgram(
          "base",
          `function ${name}(x: Uint256): Uint256 { return x + 1; }\nfunction main(): Uint256 { return ${name}(2); }`,
        ).bytecode,
      );
    expect(own("available")).toEqual(own("plus"));
  });
});

/**
 * The bytes `available(X)` compiled to on `main`, captured from that build, each beside the same
 * decision written as a test of the name: one program on a chain with the name and one without.
 * Moving from one spelling to the other moves no byte.
 */
const ON_MAIN: readonly { source: string; chain: string; bytecode: string }[] = [
  {
    // main: if (available(UniswapV3.Factory)) { ... }
    source:
      "function main(a: Address, b: Address): Uint256 { if (UniswapV3.Factory) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
    chain: "base",
    bytecode:
      "a502009dd1514702000eb19000b6d002005d01209554e102007d0120955401001433128a8fc17869897dce68ed026d694621f6fdfd0201f4f1e3f1e3e4a00320202090041698ee829602a3a101149701208ae1d1890520000000003100",
  },
  {
    source:
      "function main(a: Address, b: Address): Uint256 { if (UniswapV3.Factory) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
    chain: "linea",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010001208ae1d1890520000000003100",
  },
  {
    // main: const both = available(USDT) && available(UniswapV3.Factory);
    source:
      "function main(): Uint256 { const both = USDT && UniswapV3.Factory; return both ? 1 : 2; }",
    chain: "ethereum",
    bytecode: "010101208ae1d1890520000000003100",
  },
  {
    // main: if (!available(PancakeswapV3.Factory)) { return 0n; }, in a function main calls
    source:
      "function quote(a: Address, b: Address): Uint256 { if (!PancakeswapV3.Factory) { return 0; } return PancakeswapV3.Factory.getPool(a, b, 500); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1; }",
    chain: "base",
    bytecode:
      "a50200acd1514702000eb19000b6d002006c01209554e102008c01209554020027f1f1020039b00101e12101208ae1d18905200000000031000100140bfbcf9fa4f9c56b0f40a671ad40e0805a0918650201f4f1e3f1e3e4a00320202090041698ee829602a3a1011497e1b0",
  },
  {
    source:
      "function quote(a: Address, b: Address): Uint256 { if (!PancakeswapV3.Factory) { return 0; } return PancakeswapV3.Factory.getPool(a, b, 500); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1; }",
    chain: "optimism",
    bytecode:
      "a5020073d1514702000eb19000b6d002003301209554e002005301209554e001000101e12101208ae1d1890520000000003100",
  },
  {
    // main: if (available(Linea.UniswapV3.Factory)) { return 1n; } else { return 2n; }
    source:
      "function main(): Uint256 { if (Linea.UniswapV3.Factory) { return 1; } else { return 2; } }",
    chain: "base",
    bytecode: "010201208ae1d1890520000000003100",
  },
];

describe("a test of the name compiles to the bytes available(X) did on main", () => {
  // An early return ends its block only on a compiler built from #550.
  const now = ON_MAIN.filter((entry) => !entry.source.includes("if (!"));
  const later = ON_MAIN.filter((entry) => entry.source.includes("if (!"));
  it.each(later.map((entry) => [`${entry.chain}: ${entry.source}`, entry] as const))(
    "%s",
    (_name, { source, chain, bytecode }) => {
      expect(Buffer.from(compileSauceProgram(chain, source).bytecode).toString("hex")).toBe(
        bytecode,
      );
    },
  );
  it.each(now.map((entry) => [`${entry.chain}: ${entry.source}`, entry] as const))(
    "%s",
    (_name, { source, chain, bytecode }) => {
      expect(Buffer.from(compileSauceProgram(chain, source).bytecode).toString("hex")).toBe(
        bytecode,
      );
    },
  );
});
