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
  if (PancakeswapV3.Factory != 0n) {
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
      if (PancakeswapV3.Factory != 0n) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
      } else if (UniswapV3.Factory != 0n) {
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
      if (PancakeswapV3.Factory == 0n) {
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
        "return PancakeswapV3.Factory != 0n ? PancakeswapV3.Factory.getPool(USDC, WETH, 500n) : 7n;",
      ),
    ).toEqual(build("optimism", "return 7n;"));
    expect(
      build(
        "optimism",
        "if (PancakeswapV3.Factory != 0n && PancakeswapV3.Factory.getPool(USDC, WETH, 500n) > 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(build("optimism", "return 0n;"));
    expect(
      build(
        "base",
        "if (PancakeswapV3.Factory == 0n || PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    ).toEqual(
      build(
        "base",
        "if (PancakeswapV3.Factory.getPool(USDC, WETH, 500n) == 0n) { return 1n; }\nreturn 0n;",
      ),
    );
  });

  it("the comparison is a value too, decided wherever it is used", () => {
    expect(build("optimism", "const has = UniswapV3.Factory != 0n;\nreturn has;")).toEqual(
      build("optimism", "const has = true;\nreturn has;"),
    );
  });

  it("a branch behind a variable the program may change stays live code", () => {
    expect(() =>
      build(
        "optimism",
        "let has = PancakeswapV3.Factory != 0n;\nif (has) { return PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }\nreturn 0n;",
      ),
    ).toThrow(/not deployed on 'optimism'/);
  });
});

describe("what a chain can lack", () => {
  it("a token symbol, by the chain's token map: the registry and the caller's tokens", () => {
    const usdt = "return USDT != 0n ? USDT.balanceOf(self) : 0n;";
    expect(build("ethereum", usdt)).toEqual(build("ethereum", "return USDT.balanceOf(self);"));
    expect(build("base", usdt)).toEqual(build("base", "return 0n;"));
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    expect(build("base", usdt, tokens)).toEqual(
      build("base", "return USDT.balanceOf(self);", tokens),
    );
  });

  it("a family member and a chain-qualified contract", () => {
    expect(build("base", "return Uniswap.UniversalRouter != 0n;")).toEqual(
      build("base", "return true;"),
    );
    // Named on another chain, the check is that chain's, whatever the program is compiled for.
    expect(build("base", "return Optimism.PancakeswapV3.Factory != 0n;")).toEqual(
      build("base", "return false;"),
    );
  });

  it("on an svm chain no EVM contract is there", () => {
    const solana = (body: string) =>
      Array.from(compileSauceProgram("solana", `function main() {\n${body}\n}`).bytecode);
    expect(solana("return UniswapV3.Factory != 0n;")).toEqual(solana("return false;"));
  });

  it.each([
    ["a symbol no chain registers", "USDX != 0n", /USDX/],
    ["a namespace no registry protocol has", "Nope.Factory != 0n", /Nope/],
    ["a protocol with several contracts", "UniswapV3 != 0n", /names no single contract/],
    ["an ambiguous family name", "Uniswap.Factory != 0n", /ambiguous under Uniswap/],
  ])("refuses %s where it is compiled", (_what, check, error) => {
    expect(() => build("base", `return ${check};`)).toThrow(error);
  });

  // Pending the compiler: a member nothing set reads as `undefined`, which compares unequal to
  // zero rather than being refused.
  it.failing("refuses a contract the protocol does not have where it is compiled", () => {
    expect(() => build("base", "return UniswapV3.Factroy != 0n;")).toThrow(/Factroy/);
  });

  it("an interface is on every chain: an ABI the program calls at an address", () => {
    expect(build("base", "return Erc4626.Vault != 0n;")).toEqual(build("base", "return true;"));
  });

  it("a name the program binds is its own, and never asked about", () => {
    expect(build("base", "const USDC = 5n;\nreturn USDC;")).toEqual(build("base", "return 5n;"));
  });

  it("an intent's body decides it for its own chain", () => {
    const intents = {
      deadline: 4_000_000_000n,
      executionFee: 0n,
    } as const;
    const program = (guarded: string) => `function main() {
  const amount = USDC.balanceOf(self);
  Optimism.Portal.send([{ token: USDC, amount }]).refundee(0x3333333333333333333333333333333333333333).receive().then(() => {
    ${guarded}
  });
}`;
    // PancakeSwap V3 is on Base, where the program is compiled, and not on Optimism, where the body
    // runs: the body's branch is left out, so its program never names the factory.
    expect(() =>
      compileSauceProgram(
        "base",
        program(
          "if (PancakeswapV3.Factory != 0n) { PancakeswapV3.Factory.getPool(USDC, WETH, 500n); }",
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

describe("available(X) is gone", () => {
  it("calling it says to compare the name with zero", () => {
    expect(() => build("base", "return available(UniswapV3.Factory) ? 1n : 2n;")).toThrow(
      /`available\(X\)` is removed: compare the name with zero, `X != 0`/,
    );
  });

  it("a program that declares its own available keeps it", () => {
    const own = (name: string) =>
      Array.from(
        compileSauceProgram(
          "base",
          `function ${name}(x: Uint256): Uint256 { return x + 1n; }\nfunction main(): Uint256 { return ${name}(2n); }`,
        ).bytecode,
      );
    expect(own("available")).toEqual(own("plus"));
  });
});

/**
 * The bytes `available(X)` compiled to on `main`, captured from that build, each beside the same
 * decision written as the comparison with zero: one program on a chain with the name and one
 * without. Moving from one spelling to the other moves no byte.
 */
const ON_MAIN: readonly { source: string; chain: string; bytecode: string }[] = [
  {
    // main: if (available(UniswapV3.Factory)) { ... }
    source:
      "function main(a: Address, b: Address): Uint256 { if (UniswapV3.Factory != 0n) { return UniswapV3.Factory.getPool(a, b, 500n); } return 0n; }",
    chain: "base",
    bytecode:
      "a502009dd1514702000eb19000b6d002005d01209554e102007d0120955401001433128a8fc17869897dce68ed026d694621f6fdfd0201f4f1e3f1e3e4a00320202090041698ee829602a3a101149701208ae1d1890520000000003100",
  },
  {
    source:
      "function main(a: Address, b: Address): Uint256 { if (UniswapV3.Factory != 0n) { return UniswapV3.Factory.getPool(a, b, 500n); } return 0n; }",
    chain: "linea",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010001208ae1d1890520000000003100",
  },
  {
    // main: const both = available(USDT) && available(UniswapV3.Factory);
    source:
      "function main(): Uint256 { const both = USDT != 0n && UniswapV3.Factory != 0n; return both ? 1n : 2n; }",
    chain: "ethereum",
    bytecode: "010101208ae1d1890520000000003100",
  },
  {
    source:
      "function main(): Uint256 { const both = USDT != 0n && UniswapV3.Factory != 0n; return both ? 1n : 2n; }",
    chain: "base",
    bytecode: "010201208ae1d1890520000000003100",
  },
  {
    // main: if (!available(PancakeswapV3.Factory)) { return 0n; }, in a function main calls
    source:
      "function quote(a: Address, b: Address): Uint256 { if (PancakeswapV3.Factory == 0n) { return 0n; } return PancakeswapV3.Factory.getPool(a, b, 500n); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1n; }",
    chain: "base",
    bytecode:
      "a50200acd1514702000eb19000b6d002006c01209554e102008c01209554020027f1f1020039b00101e12101208ae1d18905200000000031000100140bfbcf9fa4f9c56b0f40a671ad40e0805a0918650201f4f1e3f1e3e4a00320202090041698ee829602a3a1011497e1b0",
  },
  {
    source:
      "function quote(a: Address, b: Address): Uint256 { if (PancakeswapV3.Factory == 0n) { return 0n; } return PancakeswapV3.Factory.getPool(a, b, 500n); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1n; }",
    chain: "optimism",
    bytecode:
      "a5020073d1514702000eb19000b6d002003301209554e002005301209554e001000101e12101208ae1d1890520000000003100",
  },
  {
    // main: if (available(Linea.UniswapV3.Factory)) { return 1n; } else { return 2n; }
    source:
      "function main(): Uint256 { if (Linea.UniswapV3.Factory != 0n) { return 1n; } else { return 2n; } }",
    chain: "base",
    bytecode: "010201208ae1d1890520000000003100",
  },
];

describe("the comparison compiles to the bytes available(X) did on main", () => {
  it.each(ON_MAIN.map((entry) => [`${entry.chain}: ${entry.source}`, entry] as const))(
    "%s",
    (_name, { source, chain, bytecode }) => {
      expect(Buffer.from(compileSauceProgram(chain, source).bytecode).toString("hex")).toBe(
        bytecode,
      );
    },
  );
});
