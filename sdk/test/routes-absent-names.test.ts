/**
 * One program that uses a venue only on the chains that have it. A registry name a chain lacks is
 * declared there as zero (`routes/chain-module.ts`). A test of it — `if (X)`, `!X`, `X != 0`,
 * `X == 0`, `?:`, `&&`, `||` — is decided while the program compiles, and the branch it rules out is
 * not compiled: nothing in it resolves, not even a call on the absent contract. Any other use is
 * refused before the compiler runs, at the use, naming the chain (`routes/absent-names.ts`), so a
 * zero never reaches the chain as an address.
 */
import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { checkNames, withoutDead } from "../src/routes/absent-names.js";
import {
  CHAIN_MODULE_ROOT,
  chainNames,
  INSTALLED_CHAIN_MODULE,
} from "../src/routes/chain-module.js";
import { compileWithRs, makeResolve } from "../src/routes/rs-compile.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

/** Compiles `body` (a `main` body) for `chain`, returning the bytecode as hex. */
function build(
  chain: string,
  body: string,
  options: Parameters<typeof compileSauceProgram>[2] = {},
): string {
  return hex(chain, `function main() {\n${body}\n}`, options);
}

function hex(
  chain: string,
  source: string,
  options: Parameters<typeof compileSauceProgram>[2] = {},
): string {
  return Buffer.from(compileSauceProgram(chain, source, options).bytecode).toString("hex");
}

/** The message `source` is refused with on `chain`. */
function refusal(
  chain: string,
  source: string,
  options: Parameters<typeof compileSauceProgram>[2] = {},
): string {
  try {
    compileSauceProgram(chain, source, options);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`compiled on ${chain}: ${source}`);
}

/** The one source that runs everywhere: PancakeSwap V3 where it is deployed, else nothing. */
const VENUE = `
  let pool = 0;
  if (PancakeswapV3.Factory) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
`;
const NOTHING = "let pool = 0;\nreturn pool;";

describe("a name the chain lacks is zero: one program, the venue only where the chain has it", () => {
  it("the registry agrees with the premise: PancakeSwap V3 is on Base and not on Optimism", () => {
    const factory = getDescriptor("pancakeswap-v3", "Factory")!;
    expect(factory.chains).toContain("base");
    expect(factory.chains).not.toContain("optimism");
  });

  it("keeps the branch on a chain with the contract: Base calls its factory", () => {
    const address = getDescriptor("pancakeswap-v3", "Factory")!.perChainAddress[8453]!;
    expect(build("base", VENUE)).toContain(address.slice(2).toLowerCase());
    expect(build("base", VENUE)).not.toBe(build("base", NOTHING));
  });

  it("drops the branch on a chain without it, call and all: Optimism compiles the program without it", () => {
    expect(build("optimism", VENUE)).toBe(build("optimism", NOTHING));
  });

  it.each([
    [
      "if (X)",
      "if (PancakeswapV3.Factory) { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500); }",
    ],
    [
      "X != 0",
      "if (PancakeswapV3.Factory != 0) { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500); }",
    ],
    [
      "0 != X",
      "if (0 != PancakeswapV3.Factory) { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500); }",
    ],
    [
      "X == 0 else",
      "if (PancakeswapV3.Factory == 0) { } else { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500); }",
    ],
    [
      "!X else",
      "if (!PancakeswapV3.Factory) { } else { pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500); }",
    ],
  ])("every test spelling decides it: %s", (_spelling, test) => {
    const body = `let pool = 0;\n${test}\nreturn pool;`;
    expect(build("optimism", body)).toBe(build("optimism", NOTHING));
    expect(build("base", body)).toBe(build("base", VENUE));
  });

  it("an else-if ladder takes the first venue the chain has", () => {
    const ladder = `
      let pool = 0;
      if (PancakeswapV3.Factory) {
        pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
      } else if (UniswapV3.Factory) {
        pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
      }
      return pool;
    `;
    expect(build("base", ladder)).toBe(
      build(
        "base",
        "let pool = 0;\npool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);\nreturn pool;",
      ),
    );
    expect(build("optimism", ladder)).toBe(
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
    expect(build("base", guard)).toBe(
      build("base", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500);"),
    );
    expect(build("optimism", guard)).toBe(build("optimism", "return 0;"));
  });

  it("?:, && and || decide the same way", () => {
    expect(
      build(
        "optimism",
        "return PancakeswapV3.Factory ? PancakeswapV3.Factory.getPool(USDC, WETH, 500) : 7;",
      ),
    ).toBe(build("optimism", "return 7;"));
    expect(
      build(
        "optimism",
        "if (PancakeswapV3.Factory && PancakeswapV3.Factory.getPool(USDC, WETH, 500) > 0) { return 1; }\nreturn 0;",
      ),
    ).toBe(build("optimism", "return 0;"));
    expect(
      build(
        "optimism",
        "if (!PancakeswapV3.Factory || PancakeswapV3.Factory.getPool(USDC, WETH, 500) == 0) { return 1; }\nreturn 0;",
      ),
    ).toBe(build("optimism", "return 1;"));
    // The first of two contracts the chain has is `X ? X : Y`.
    expect(
      build(
        "optimism",
        "const either: Address = PancakeswapV3.Factory ? PancakeswapV3.Factory : UniswapV3.Factory;\nreturn either;",
      ),
    ).toBe(build("optimism", "const either: Address = UniswapV3.Factory;\nreturn either;"));
  });

  it("the comparison is a value too, decided wherever it is used", () => {
    expect(build("optimism", "const has = PancakeswapV3.Factory != 0;\nreturn has;")).toBe(
      build("optimism", "const has = false;\nreturn has;"),
    );
  });
});

describe("a use of a name the chain lacks outside a branch its test rules out is refused, naming the chain", () => {
  it.each([
    ["a call", "return PancakeswapV3.Factory.getPool(USDC, WETH, 500);"],
    ["a value returned", "const f: Address = PancakeswapV3.Factory;\nreturn f;"],
    ["an argument", "USDC.approve(PancakeswapV3.Factory, 1);"],
    [
      "the address a binding is given",
      "return UniswapV3.Factory.at(PancakeswapV3.Factory).getPool(USDC, WETH, 500);",
    ],
    [
      "a branch behind a value the program may change",
      "let has = PancakeswapV3.Factory != 0;\nif (has) { return PancakeswapV3.Factory.getPool(USDC, WETH, 500); }\nreturn 0;",
    ],
    [
      "the other arm of its test",
      "if (PancakeswapV3.Factory) { return 1; }\nreturn PancakeswapV3.Factory.getPool(USDC, WETH, 500);",
    ],
  ])("%s", (_what, body) => {
    const message = refusal("optimism", `function main() {\n${body}\n}`);
    expect(message).toMatch(/`PancakeswapV3\.Factory` is not deployed on optimism/);
    expect(message).toMatch(/--> main\.js:\d+:\d+/);
  });

  it("`X || Y` and `X && Y` give true or false: a contract under them, as a value, is made the bool", () => {
    // 2.6.0 hands a contract binding under `&&`/`||` back as the whole; the SDK writes each such
    // side `!!(…)`, the bool the language gives, so the program reads as written with `!!`.
    const factory = (chain: number) =>
      getDescriptor("uniswap-v3", "Factory")!.perChainAddress[chain]!.slice(2).toLowerCase();
    for (const [chain, id, body, normalized] of [
      [
        "optimism",
        10,
        "const a = UniswapV3.Factory;\nreturn a || 0;",
        "const a = UniswapV3.Factory;\nreturn !!(a) || 0;",
      ],
      [
        "base",
        8453,
        "const a = UniswapV3.Factory;\nreturn a || 0;",
        "const a = UniswapV3.Factory;\nreturn !!(a) || 0;",
      ],
      [
        "base",
        8453,
        "const a = UniswapV3.Factory;\nconst b = a;\nlet c = b;\nreturn 0 || c;",
        "const a = UniswapV3.Factory;\nconst b = a;\nlet c = b;\nreturn 0 || !!(c);",
      ],
      [
        "base",
        8453,
        "const r = { f: UniswapV3.Factory };\nreturn r.f && 1;",
        "const r = { f: UniswapV3.Factory };\nreturn !!(r.f) && 1;",
      ],
      [
        "optimism",
        10,
        "const both = PancakeswapV3.Factory || UniswapV3.Factory;\nreturn both;",
        "const both = !!(PancakeswapV3.Factory) || !!(UniswapV3.Factory);\nreturn both;",
      ],
      ["base", 8453, "return 1 && UniswapV3.Factory;", "return 1 && !!(UniswapV3.Factory);"],
      [
        "base",
        8453,
        "const fs = [UniswapV3.Factory, UniswapV3.QuoterV2];\nreturn fs[0] || fs[1];",
        "const fs = [UniswapV3.Factory, UniswapV3.QuoterV2];\nreturn !!(fs[0]) || !!(fs[1]);",
      ],
      [
        "base",
        8453,
        "const r = { a: { f: UniswapV3.Factory } };\nconst g = r.a;\nreturn g.f || 0;",
        "const r = { a: { f: UniswapV3.Factory } };\nconst g = r.a;\nreturn !!(g.f) || 0;",
      ],
    ] as const) {
      const program = hex(chain, `function main() {\n${body}\n}`);
      expect(program).toBe(hex(chain, `function main() {\n${normalized}\n}`));
      expect(program).not.toContain(factory(id));
    }
    // A binding the program writes too (`<Abi>.at(x)`, an ABI it imports), and the whole is a bool
    // wherever a value goes: an Address is refused by the compiler, as `&&`/`||` of anything else
    // always was.
    const user = "function main(x: Address, y: Address) {\nreturn IERC20.at(x) || y;\n}";
    const { bindingSides } = checkNames(user, chainNames(requireChain("base")));
    expect(withoutDead(user, [], bindingSides)).toBe(
      "function main(x: Address, y: Address) {\nreturn !!(IERC20.at(x)) || y;\n}",
    );
    expect(
      refusal(
        "optimism",
        "function main(): Address {\nconst either: Address = PancakeswapV3.Factory || UniswapV3.Factory;\nreturn either;\n}",
      ),
    ).toMatch(/expected a number, found a bool/);
    // A test of one is a test, left as written, and a scalar side is never rewritten.
    for (const body of [
      "const a = UniswapV3.Factory;\nconst b = a;\nif (b || x != 0) { return 1; }\nreturn 0;",
      "const a = UniswapV3.Factory;\nreturn !a ? 1 : 2;",
      "const a = UniswapV3.Factory;\nrequire(a && UniswapV3.QuoterV2);\nreturn 1;",
      "const ok = x != 0 || y != 0;\nreturn ok ? 1 : 0;",
    ]) {
      const source = `function main(x: Address, y: Address): Uint256 {\n${body}\n}`;
      const { bindingSides } = checkNames(source, chainNames(requireChain("base")));
      expect(bindingSides).toEqual([]);
      expect(() => hex("base", source)).not.toThrow();
    }
  });

  it("a token the chain lacks, used: a transfer, a balance, an argument", () => {
    for (const body of [
      "USDT.transfer(0x1234, 1);",
      "return USDT.balanceOf(pot);",
      "return Token(USDT).balanceOf(pot);",
      "const t: Address = USDT; return t;",
    ]) {
      expect(refusal("base", `function main() {\n${body}\n}`)).toMatch(
        /`USDT` is not a token on base/,
      );
    }
  });

  it("a helper is checked as if it ran: a ruled-out branch's call does not excuse it", () => {
    const source = `function quote(): Uint256 { return PancakeswapV3.Factory.getPool(USDC, WETH, 500); }
function main(): Uint256 { if (PancakeswapV3.Factory) { return quote(); } return 0; }`;
    expect(refusal("optimism", source)).toMatch(
      /`PancakeswapV3\.Factory` is not deployed on optimism/,
    );
    expect(() => hex("base", source)).not.toThrow();
  });

  it("a name a function declares is its own only in that function", () => {
    // A parameter named like a token shadows it in its own function, not in main.
    const usdt = `function helper(USDT: Address): Address { return USDT; }
function main(): Address { return USDT; }`;
    expect(refusal("base", usdt)).toMatch(/`USDT` is not a token on base/);
    const namespace = `function helper(UniswapV3: Uint256): Uint256 { return UniswapV3; }
function main(a: Address, b: Address): Uint256 { return UniswapV3.Factory.getPool(a, b, 500); }`;
    expect(refusal("linea", namespace)).toMatch(/`UniswapV3\.Factory` is not deployed on linea/);
    // In its own function the parameter is the program's.
    expect(() =>
      hex(
        "base",
        "function helper(USDT: Address): Address { return USDT; }\nfunction main(a: Address): Address { return helper(a); }",
      ),
    ).not.toThrow();
    expect(build("base", "const USDT = 5;\nreturn USDT;")).toBe(build("base", "return 5;"));
  });

  it("a block's declaration is its own only in the block, and from the declaration on", () => {
    // Base registers no USDT, so after the block `USDT` is the chain's zero: a return of it would
    // be the zero address. The compiler scopes each binding to its block, loop or clause, and reads
    // a name before a local declaration of it as the outer one.
    const after = (block: string) =>
      `function main(flag: Uint256): Address {\n  ${block}\n  return USDT;\n}`;
    for (const block of [
      "if (flag == 1) { const USDT = 1; require(USDT != 0); }",
      "if (flag == 1) { if (flag == 2) { const USDT = 1; require(USDT != 0); } }",
      "try { require(flag == 1); } catch (USDT) { }",
      "for (const USDT of [1, 2]) { require(USDT != 0); }",
      "for (let USDT = 0; USDT < 2; USDT++) { require(flag != USDT); }",
    ]) {
      const message = refusal("base", after(block));
      expect(message).toMatch(/`USDT` is not a token on base/);
      expect(message).toMatch(/--> main\.js:3:10/);
    }
    expect(
      refusal(
        "base",
        "function main(): Address {\n  const early = USDT;\n  const USDT = 1;\n  return early;\n}",
      ),
    ).toMatch(/`USDT` is not a token on base[\s\S]*--> main\.js:2:17/);
    // A namespace the same way: Linea has no Uniswap V3 factory.
    expect(
      refusal(
        "linea",
        "function main(flag: Uint256, a: Address, b: Address): Address {\n  if (flag == 1) { const UniswapV3 = 1; require(UniswapV3 != 0); }\n  return UniswapV3.Factory.getPool(a, b, 500);\n}",
      ),
    ).toMatch(/`UniswapV3\.Factory` is not deployed on linea[\s\S]*--> main\.js:3:10/);
    // Inside its block, loop or clause the binding is the program's.
    expect(
      hex(
        "base",
        "function main(flag: Uint256): Address { if (flag == 1) { const USDT = 1; return USDT; } return 0; }",
      ),
    ).toBe(
      hex(
        "base",
        "function main(flag: Uint256): Address { if (flag == 1) { return 1; } return 0; }",
      ),
    );
    expect(() =>
      hex(
        "base",
        "function main(): Uint256 { let s = 0; for (const USDT of [1, 2]) { s = s + USDT; } return s; }",
      ),
    ).not.toThrow();
    // A function's own `const`, before the use, holds for the rest of the function, past a block.
    expect(
      build(
        "base",
        "const USDT = 5;\nif (USDT == 5) { const x = 1; require(x != 0); }\nreturn USDT;",
      ),
    ).toBe(
      build("base", "const USDT = 5;\nif (USDT == 5) { const x = 1; require(x != 0); }\nreturn 5;"),
    );
  });

  it("a type-only import binds no value, so it hides no name the chain lacks", () => {
    // The compiler erases `import type { X }` and `import { type X }`: `USDT` below is the chain's,
    // which Base does not register, and a return of it would be the zero address.
    const resolve = (path: string) =>
      path === "./t.js" ? new TextEncoder().encode("export type USDT = Uint256;\n") : undefined;
    for (const line of [
      'import type { USDT } from "./t.js";',
      'import { type USDT } from "./t.js";',
    ]) {
      const message = refusal("base", `${line}\nfunction main(): Address { return USDT; }`, {
        resolve,
      });
      expect(message).toMatch(/`USDT` is not a token on base/);
      expect(message).toMatch(/--> main\.js:2:35/);
    }
  });

  it("an element of a list built from contracts is one, by any index, alias or nesting; a scalar list is left", () => {
    for (const [body, normalized] of [
      [
        "const fs = [UniswapV3.Factory, UniswapV3.QuoterV2];\nreturn fs[i] || 0;",
        "const fs = [UniswapV3.Factory, UniswapV3.QuoterV2];\nreturn !!(fs[i]) || 0;",
      ],
      [
        "const fs = [UniswapV3.Factory];\nconst gs = fs;\nreturn gs[0] || 0;",
        "const fs = [UniswapV3.Factory];\nconst gs = fs;\nreturn !!(gs[0]) || 0;",
      ],
      [
        "const ns = [[UniswapV3.QuoterV2, UniswapV3.Factory]];\nreturn ns[0][1] || 0;",
        "const ns = [[UniswapV3.QuoterV2, UniswapV3.Factory]];\nreturn !!(ns[0][1]) || 0;",
      ],
      [
        "const fs = [UniswapV3.Factory];\nconst k = fs[0];\nreturn k || 0;",
        "const fs = [UniswapV3.Factory];\nconst k = fs[0];\nreturn !!(k) || 0;",
      ],
    ]) {
      const program = hex("base", `function main(i: Uint256) {\n${body}\n}`);
      expect(program).toBe(hex("base", `function main(i: Uint256) {\n${normalized}\n}`));
    }
    for (const body of ["const xs = [1, 2];\nreturn xs[i] || 0;", "return us[0] || us[1];"]) {
      const source = `function main(i: Uint256, us: Uint256[]) {\n${body}\n}`;
      expect(checkNames(source, chainNames(requireChain("base"))).bindingSides).toEqual([]);
    }
  });

  it("a module the program imports gets the same bool from `&&`/`||` on a contract", () => {
    const served = (helper: string) => (path: string) =>
      path.replace(/^\.\//, "") === "h.js" ? new TextEncoder().encode(helper) : undefined;
    const main = `import { pick } from "./h.js";\nfunction main() { return pick(); }`;
    for (const [body, normalized] of [
      ["return UniswapV3.Factory || 0;", "return !!(UniswapV3.Factory) || 0;"],
      [
        "const a = UniswapV3.Factory; return a || 0;",
        "const a = UniswapV3.Factory; return !!(a) || 0;",
      ],
    ]) {
      const program = hex("base", main, {
        resolve: served(`export function pick() { ${body} }`),
      });
      expect(program).toBe(
        hex("base", main, { resolve: served(`export function pick() { ${normalized} }`) }),
      );
      expect(program).not.toContain(
        getDescriptor("uniswap-v3", "Factory")!.perChainAddress[8453]!.slice(2).toLowerCase(),
      );
    }
  });

  it("a module the program imports is read the same way", () => {
    const helper = `export function owed(): Address { return USDT; }`;
    const spender = `export function spend(): Uint256 { USDC.approve(PancakeswapV3.Factory, 1); return 0; }`;
    const resolve = (modules: Record<string, string>) => (path: string) => {
      const text = modules[path.replace(/^\.\//, "")];
      return text === undefined ? undefined : new TextEncoder().encode(text);
    };
    const main = `import { owed } from "./helper.js";\nfunction main(): Address { return owed(); }`;
    const message = refusal("base", main, { resolve: resolve({ "helper.js": helper }) });
    expect(message).toMatch(/`USDT` is not a token on base/);
    expect(message).toMatch(/--> \.\/helper\.js:1:\d+/);
    const approve = `import { spend } from "./spend.js";\nfunction main(): Uint256 { return spend(); }`;
    expect(refusal("optimism", approve, { resolve: resolve({ "spend.js": spender }) })).toMatch(
      /`PancakeswapV3\.Factory` is not deployed on optimism/,
    );
    // The same module on a chain that has the names compiles.
    expect(() =>
      hex("ethereum", main, { resolve: resolve({ "helper.js": helper }) }),
    ).not.toThrow();
  });

  it("the chain's names are never imported under a name of the program's own, however spelled", () => {
    for (const [specifier, name] of [
      ["@sauce/chain", "USDT"],
      ["@sauce/chain/", "USDT"],
      ["@sauce/chain-optimism", "Optimism"],
      ["/@eco-incorp/sauce/chain/base.js", "USDT"],
      ["./@eco-incorp/sauce/./chain/base.js", "USDT"],
      ["./x/../@eco-incorp//sauce/chain/base.js", "USDT"],
    ] as const) {
      const message = refusal(
        "base",
        `import { ${name} as missing } from "${specifier}";\nfunction main(): Address { return missing; }`,
      );
      expect(message).toMatch(/is the chain's names, which a program reads with no import/);
      expect(message).toMatch(/--> main\.js:1:1/);
    }
    // A module the caller serves, which reaches them by a path relative to itself.
    const served = (modules: Record<string, string>) => (path: string) => {
      const text = modules[path.replace(/^\.\//, "")];
      return text === undefined ? undefined : new TextEncoder().encode(text);
    };
    const message = refusal(
      "base",
      `import { owed } from "./lib/helper.js";\nfunction main(): Address { return owed(); }`,
      {
        resolve: served({
          "lib/helper.js": `import { USDT as missing } from "../@eco-incorp/sauce/chain/base.js";\nexport function owed(): Address { return missing; }`,
        }),
      },
    );
    expect(message).toMatch(/is the chain's names, which a program reads with no import/);
    expect(message).toMatch(/--> \.\/lib\/helper\.js:1:1/);
  });

  it("nor reached by an import whose name says nothing: the caller's resolvePackage may not map one there", () => {
    for (const path of ["/@eco-incorp/sauce/chain/base.js", "./@eco-incorp/sauce/chain/base.js"]) {
      const message = refusal(
        "base",
        `import { USDT as missing } from "names";\nfunction main(): Address { return missing; }`,
        { resolvePackage: (specifier: string) => (specifier === "names" ? path : undefined) },
      );
      expect(message).toMatch(/`names` resolves to `[^`]+`, the chain's names/);
      expect(message).toMatch(/--> main\.js:1:1/);
    }
    // The names themselves, and a chain's by its name, are the compile's as ever.
    expect(() =>
      hex("base", "function main(): Address { return UniswapV3.Factory; }"),
    ).not.toThrow();
    expect(
      hex("optimism", "function main(): Address { return Base.UniswapV3.Factory; }"),
    ).toContain(
      getDescriptor("uniswap-v3", "Factory")!.perChainAddress[8453]!.slice(2).toLowerCase(),
    );
  });

  it("the compile serves them to its own installation alone, whatever the check reads", () => {
    // Installed under a name of this process's own, which no program can write: `@sauce/chain`
    // finds nothing, even compiled with no check.
    expect(INSTALLED_CHAIN_MODULE).toMatch(/^@sauce\/chain-[0-9a-f]{32}$/);
    const names = chainNames(requireChain("base"));
    const installed = {
      target: "v12" as const,
      ambient: [INSTALLED_CHAIN_MODULE],
      packages: { [INSTALLED_CHAIN_MODULE]: `${CHAIN_MODULE_ROOT}/${names.path}` },
    };
    expect(() =>
      compileWithRs({ ...installed, source: "function main(): bool { return USDT == 0; }" }),
    ).not.toThrow();
    expect(() =>
      compileWithRs({
        ...installed,
        source: `import { USDT as missing } from "@sauce/chain";\nfunction main(): Address { return missing; }`,
      }),
    ).toThrow();
    // A path into them, relative to any module, finds nothing and is refused.
    const refused: Error[] = [];
    const resolve = makeResolve("", undefined, undefined, (error) => refused.push(error));
    expect(resolve(`.${CHAIN_MODULE_ROOT}/${names.path}`)).toBeUndefined();
    expect(refused.map((error) => error.message)).toEqual([
      expect.stringMatching(/is the chain's names, which a program reads with no import/),
    ]);
    expect(resolve(`${CHAIN_MODULE_ROOT}/${names.path}`)).toBeDefined();
  });

  it("require(X != 0) on a chain without X fails whatever the program does, and is refused", () => {
    expect(
      refusal("optimism", "function main() {\nrequire(PancakeswapV3.Factory != 0);\n}"),
    ).toMatch(
      /fails on optimism whatever the program does: `PancakeswapV3\.Factory` is not deployed on optimism/,
    );
    expect(() => build("base", "require(PancakeswapV3.Factory != 0);")).not.toThrow();
  });

  it("require's condition is a test: `require(X && Y)` holds the program to both", () => {
    const both = "require(UniswapV3.Factory && PancakeswapV3.Factory);\nreturn 1;";
    expect(() => build("base", both)).not.toThrow();
    expect(refusal("optimism", `function main() {\n${both}\n}`)).toMatch(
      /fails on optimism whatever the program does: `PancakeswapV3\.Factory` is not deployed on optimism/,
    );
  });
});

describe("what a chain can lack", () => {
  it("a token symbol, by the chain's token map: the registry and the caller's tokens", () => {
    const usdt = "return USDT ? USDT.balanceOf(pot) : 0;";
    expect(build("ethereum", usdt)).toBe(build("ethereum", "return USDT.balanceOf(pot);"));
    expect(build("base", usdt)).toBe(build("base", "return 0;"));
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    expect(build("base", usdt, { tokens })).toBe(
      build("base", "return USDT.balanceOf(pot);", { tokens }),
    );
  });

  it("a family member and a chain-qualified contract", () => {
    expect(build("base", "return Uniswap.UniversalRouter != 0;")).toBe(
      build("base", "return true;"),
    );
    // Named on another chain, the test is that chain's, whatever the program is compiled for.
    expect(build("base", "return Optimism.PancakeswapV3.Factory != 0;")).toBe(
      build("base", "return false;"),
    );
    expect(build("optimism", "return Base.PancakeswapV3.Factory != 0;")).toBe(
      build("optimism", "return true;"),
    );
    expect(
      refusal("base", "function main(): Address { return Optimism.PancakeswapV3.Factory; }"),
    ).toMatch(/`Optimism\.PancakeswapV3\.Factory` is not deployed on optimism/);
  });

  it("a chain named outside the allowed scope is refused", () => {
    expect(
      refusal("base", "function main(): Address { return Optimism.UniswapV3.Factory; }", {
        accessors: { chainScope: ["base"] },
      }),
    ).toMatch(
      /chain 'optimism' \(referenced as 'Optimism\.\.\.\.'\) is outside the allowed chainScope/,
    );
  });

  it("on Solana no EVM contract is there, and a branch that tests one compiles to nothing", () => {
    expect(build("solana", "return UniswapV3.Factory != 0;")).toBe(
      build("solana", "return false;"),
    );
    expect(
      hex(
        "solana",
        "function main(a: Address, b: Address): Uint256 { if (UniswapV3.Factory) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
      ),
    ).toBe(hex("solana", "function main(a: Address, b: Address): Uint256 { return 0; }"));
    // EVM-only code in the branch Solana rules out is never compiled for Solana.
    expect(build("solana", "if (UniswapV3.Factory) { return evm.sload(0); }\nreturn 1;")).toBe(
      build("solana", "return 1;"),
    );
    expect(
      refusal(
        "solana",
        "function main(a: Address, b: Address): Uint256 { return UniswapV3.Factory.getPool(a, b, 500); }",
      ),
    ).toMatch(/`UniswapV3\.Factory` is not deployed on solana/);
  });

  it("on Solana a token it lacks is the same: the Pot's balance of it, and Token(it), only under a test", () => {
    // Solana registers no WETH. A ruled-out read of the Pot's balance adds no account.
    const read = compileSauceProgram(
      "solana",
      "function main(): Uint256 { if (WETH) { return pot.WETH; } return 0; }",
    );
    expect(Buffer.from(read.bytecode).toString("hex")).toBe(build("solana", "return 0;"));
    expect(read.derivedAccounts ?? {}).toEqual({});
    expect(build("solana", "if (!WETH) { return 0; }\nreturn pot.WETH;")).toBe(
      build("solana", "return 0;"),
    );
    expect(
      hex(
        "solana",
        "function main(to: Account): Uint256 { if (WETH) { Token(WETH).transfer(to, 1); } return 0; }",
      ),
    ).toBe(hex("solana", "function main(to: Account): Uint256 { return 0; }"));
    // Anywhere else it is refused before anything compiles, at the read, as on an EVM chain: no
    // stand-in for the Pot reaches the compiler.
    for (const [chain, symbol] of [
      ["solana", "WETH"],
      ["base", "USDT"],
    ] as const) {
      for (const holder of ["pot", "ctx.self()"]) {
        const source = `function main(): Uint256 { return ${holder}.${symbol}; }`;
        expect(refusal(chain, source)).toMatch(
          new RegExp(
            `\`${symbol}\` is not a token on ${chain}\\. [\\s\\S]*--> main\\.js:1:${source.indexOf(`.${symbol}`) + 2}`,
          ),
        );
        expect(
          refusal(
            chain,
            `function main(): Uint256 { if (${holder}.${symbol} > 0) { return 1; } return 0; }`,
          ),
        ).toMatch(new RegExp(`\`${symbol}\` is not a token on ${chain}\\.`));
      }
    }
    expect(
      refusal(
        "solana",
        "function main(to: Account): Uint256 { Token(WETH).transfer(to, 1); return 0; }",
      ),
    ).toMatch(/`WETH` is not a token on solana\.[\s\S]*--> main\.js:1:45/);
    // A name no chain registers keeps the Pot's own refusal.
    expect(refusal("solana", "function main(): Uint256 { return pot.USDCC; }")).toMatch(
      /`pot\.USDCC` on Solana: `USDCC` is not a token solana registers\. Did you mean `USDC`\?/,
    );
  });

  it.each([
    [
      "a contract the protocol does not have",
      "UniswapV3.Factroy != 0",
      /`UniswapV3\.Factroy` is not a contract of UniswapV3.*Did you mean `Factory`/,
    ],
    ["a symbol no chain registers", "USDX != 0", /`USDX` is not a declared variable/],
    [
      "a namespace no registry protocol has",
      "Nope.Factory != 0",
      /`Nope` is not a declared variable/,
    ],
    [
      "a protocol, which is no contract",
      "UniswapV3 != 0",
      /`UniswapV3` is a protocol, not a contract/,
    ],
    ["an ambiguous family name", "Uniswap.Factory != 0", /ambiguous under Uniswap/],
    [
      "an interface, which no chain deploys",
      "Erc4626.Vault != 0",
      /`Erc4626\.Vault` is an interface, with no address of its own/,
    ],
  ])("refuses %s on every chain", (_what, test, error) => {
    for (const chain of ["base", "solana"]) {
      expect(refusal(chain, `function main(): bool {\nreturn ${test};\n}`)).toMatch(error);
    }
  });
});

describe("available(X) is gone", () => {
  it("calling it says to test the name itself", () => {
    const message = refusal(
      "base",
      "function main(): Uint256 { return available(UniswapV3.Factory) ? 1 : 2; }",
    );
    expect(message).toMatch(/`available\(X\)` is removed: test the name itself, `if \(X\)`/);
    expect(message).toMatch(/--> main\.js:1:\d+/);
  });

  it("a program that declares its own available keeps it", () => {
    const own = (name: string) =>
      hex(
        "base",
        `function ${name}(x: Uint256): Uint256 { return x + 1; }\nfunction main(): Uint256 { return ${name}(2); }`,
      );
    expect(own("available")).toBe(own("plus"));
  });
});

/**
 * The bytes `available(X)` compiled to before it was removed (compiler 2.6.0), each beside the same
 * decision written as a test of the name and as a comparison with zero, on a chain with the name and
 * one without. Moving from one spelling to the other moves no byte.
 */
const BEFORE: readonly { chain: string; available: string; bytecode: string }[] = [
  {
    chain: "base",
    available:
      "function main(a: Address, b: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
    bytecode:
      "a50200a2d1514702000eb19000b6d002006201209554e10200820120955401001433128a8fc17869897dce68ed026d694621f6fdfdf1f1e399006402020000041698ee8200620201f40004002462a301a101149701208ae1d1890520000000003100",
  },
  {
    chain: "linea",
    available:
      "function main(a: Address, b: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010001208ae1d1890520000000003100",
  },
  {
    chain: "solana",
    available:
      "function main(a: Address, b: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Factory.getPool(a, b, 500); } return 0; }",
    bytecode: "a5020068d1514702000eb19000b6d002002801209554e002004801209554e0010001208ae1d18900",
  },
  {
    chain: "base",
    available:
      "function quote(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory)) { return 0; } return PancakeswapV3.Factory.getPool(a, b, 500); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1; }",
    bytecode:
      "a50200b0d1514702000eb19000b6d002007001209554e102009001209554020027f1f1020038b001012101208ae1d18905200000000031000100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1f1e399006402020000041698ee8200620201f40004002462a301a1011497e1b0",
  },
  {
    chain: "optimism",
    available:
      "function quote(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory)) { return 0; } return PancakeswapV3.Factory.getPool(a, b, 500); }\nfunction main(a: Address, b: Address): Uint256 { return quote(a, b) + 1; }",
    bytecode:
      "a5020072d1514702000eb19000b6d002003201209554e002005201209554e0010001013601208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(a: Address, b: Address): Uint256 { let pool = 0; if (available(PancakeswapV3.Factory)) { pool = PancakeswapV3.Factory.getPool(a, b, 500); } else if (available(UniswapV3.Factory)) { pool = UniswapV3.Factory.getPool(a, b, 500); } return pool; }",
    bytecode:
      "a50200a8d1514702000eb19000b6d002006801209554e10200880120955401000100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1e3f1e3e499006402020000041698ee8200620201f40004002462a301a1011497e1e001208ae1d1890520000000003100",
  },
  {
    chain: "optimism",
    available:
      "function main(a: Address, b: Address): Uint256 { let pool = 0; if (available(PancakeswapV3.Factory)) { pool = PancakeswapV3.Factory.getPool(a, b, 500); } else if (available(UniswapV3.Factory)) { pool = UniswapV3.Factory.getPool(a, b, 500); } return pool; }",
    bytecode:
      "a50200a8d1514702000eb19000b6d002006801209554e10200880120955401000100141f98431c8ad98523631ae4a59f267346ea31f984f1e3f1e3e499006402020000041698ee8200620201f40004002462a301a1011497e1e001208ae1d1890520000000003100",
  },
  {
    chain: "linea",
    available:
      "function main(a: Address, b: Address): Uint256 { let pool = 0; if (available(PancakeswapV3.Factory)) { pool = PancakeswapV3.Factory.getPool(a, b, 500); } else if (available(UniswapV3.Factory)) { pool = UniswapV3.Factory.getPool(a, b, 500); } return pool; }",
    bytecode:
      "a50200a8d1514702000eb19000b6d002006801209554e10200880120955401000100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1e3f1e3e499006402020000041698ee8200620201f40004002462a301a1011497e1e001208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(a: Address, b: Address): Uint256 { return available(PancakeswapV3.Factory) ? PancakeswapV3.Factory.getPool(a, b, 500) : 7; }",
    bytecode:
      "a50200a2d1514702000eb19000b6d002006201209554e1020082012095540100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1f1e399006402020000041698ee8200620201f40004002462a301a101149701208ae1d1890520000000003100",
  },
  {
    chain: "optimism",
    available:
      "function main(a: Address, b: Address): Uint256 { return available(PancakeswapV3.Factory) ? PancakeswapV3.Factory.getPool(a, b, 500) : 7; }",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010701208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(a: Address, b: Address): Uint256 { if (available(PancakeswapV3.Factory) && PancakeswapV3.Factory.getPool(a, b, 500) > 0) { return 1; } return 0; }",
    bytecode:
      "a50200bbd1514702000eb19000b6d002007b01209554e102009b012095540100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1f1e399006402020000041698ee8200620201f40004002462a301a101149701004702006bb1010101208ae1d1890520000000003100010001208ae1d1890520000000003100",
  },
  {
    chain: "optimism",
    available:
      "function main(a: Address, b: Address): Uint256 { if (available(PancakeswapV3.Factory) && PancakeswapV3.Factory.getPool(a, b, 500) > 0) { return 1; } return 0; }",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010001208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory) || PancakeswapV3.Factory.getPool(a, b, 500) == 0) { return 1; } return 0; }",
    bytecode:
      "a50200bbd1514702000eb19000b6d002007b01209554e102009b012095540100140bfbcf9fa4f9c56b0f40a671ad40e0805a091865f1f1e399006402020000041698ee8200620201f40004002462a301a101149701004402006bb1010101208ae1d1890520000000003100010001208ae1d1890520000000003100",
  },
  {
    chain: "optimism",
    available:
      "function main(a: Address, b: Address): Uint256 { if (!available(PancakeswapV3.Factory) || PancakeswapV3.Factory.getPool(a, b, 500) == 0) { return 1; } return 0; }",
    bytecode:
      "a502006fd1514702000eb19000b6d002002f01209554e002004f01209554e0010101208ae1d1890520000000003100",
  },
  {
    chain: "ethereum",
    available:
      "function main(): Uint256 { const both = available(USDT) && available(UniswapV3.Factory); return both ? 1 : 2; }",
    bytecode: "010101208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(): Uint256 { const both = available(USDT) && available(UniswapV3.Factory); return both ? 1 : 2; }",
    bytecode: "010201208ae1d1890520000000003100",
  },
  {
    chain: "ethereum",
    available:
      "function main(): Uint256 { return available(USDT) ? USDT.balanceOf(ctx.self()) : 0; }",
    bytecode:
      "010014dac17f958d2ee523a2206206994597c13d831ec764990024010100000470a08231000462a301a101209701208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(): Uint256 { return available(USDT) ? USDT.balanceOf(ctx.self()) : 0; }",
    bytecode: "010001208ae1d1890520000000003100",
  },
  {
    chain: "base",
    available:
      "function main(): Uint256 { if (available(Linea.UniswapV3.Factory)) { return 1; } else { return 2; } }",
    bytecode: "010201208ae1d1890520000000003100",
  },
  {
    chain: "solana",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory)) { return evm.sload(0); } return 1; }",
    bytecode: "010101208ae1d18900",
  },
  {
    chain: "base",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory)) { return evm.sload(0); } return 1; }",
    bytecode: "01008101208ae1d1890520000000003100",
  },
];

const CALL = /available\(([\w.]+)\)/g;
const SPELLINGS: Record<string, (source: string) => string> = {
  "if (X)": (source) => source.replace(CALL, "$1"),
  "X != 0": (source) =>
    source.replace(/!available\(([\w.]+)\)/g, "$1 == 0").replace(CALL, "$1 != 0"),
};

describe("a test of the name compiles to the bytes available(X) did", () => {
  const cases = BEFORE.flatMap((entry) =>
    Object.entries(SPELLINGS)
      // A decision held as a value is a comparison: `&&` gives true or false, so a contract under
      // it, where the whole is a value, is refused.
      .filter(([spelling]) => spelling !== "if (X)" || !entry.available.includes("const both"))
      .map(
        ([spelling, spell]) =>
          [
            `${entry.chain}, ${spelling}: ${spell(entry.available)}`,
            spell(entry.available),
            entry,
          ] as const,
      ),
  );
  it.each(cases)("%s", (_name, source, { chain, bytecode }) => {
    expect(hex(chain, source)).toBe(bytecode);
  });
});

/**
 * What `available(X)` compiled to (compiler 2.6.0, before it was removed) where the branch it ruled
 * out holds what the SDK lowers itself: a token write, a balance, a venue call, a contract bound to
 * an address, each in an `if` arm, a `?:` arm, the right side of `&&`, and the rest of a block after
 * a guard. The bytes and the accounts the program asks for are those, in either spelling.
 */
const RULED_OUT: readonly {
  chain: string;
  available: string;
  bytecode: string;
  derivedAccounts: Readonly<Record<string, string>>;
}[] = [
  {
    chain: "solana",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory)) { return USDC.mint.address; } return 0; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(pool: Address): Uint256 { if (available(UniswapV3.Factory)) { return UniswapV3.Pool(pool).liquidity(); } return 0; }",
    bytecode: "a502003fd1514702000eb19000b602001f01209554e0010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(to: Account): Uint256 { if (available(UniswapV3.Factory)) { USDC.transfer(to, 1); } return 0; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(pool: Address, amountIn: Uint256, priceLimit: Uint256): Uint256 { if (available(UniswapV3.Factory)) { return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, priceLimit, 1); } return 0; }",
    bytecode:
      "a5020091d1514702000eb19000b6d002003101209554e0d002005101209554e002007101209554e0010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory)) { return pot.USDC; } return 0; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available: "function main(): Uint256 { return available(UniswapV3.Factory) ? pot.USDC : 0; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory) && pot.USDC > 0) { return 1; } return 0; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(to: Account): Uint256 { if (!available(UniswapV3.Factory)) { return 0; } USDC.transfer(to, 1); return pot.USDC; }",
    bytecode: "010001208ae1d18900",
    derivedAccounts: {},
  },
  {
    chain: "solana",
    available:
      "function main(): Uint256 { if (available(UniswapV3.Factory)) { return 1; } else { return pot.USDC; } }",
    bytecode:
      "02002d20c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d610100010177020034b001208ae1d1890002003ef1e3d302012ab0e101200120f1e3e4815443020064b1901477726f6e6720686f6c646572206163636f756e74b6e1b02006ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9d1784302010bb1d0792006ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfcd278430200beb101000200f0b001a5d1430200ecb1020163d14401a5d2454d0200dab101000200e6b00102010101a5d4815543424242420200eeb00101424202010ab190136e6f74206120746f6b656e206163636f756e74b6e0e101200100f1e3815443020126b1900a77726f6e67206d696e74b60100e1b0020133f1d2020066b0e001080140f18155e1b0",
    derivedAccounts: { potUSDC: "pot:USDC", pot: "pot" },
  },
  {
    chain: "base",
    available:
      "function main(): Uint256 { if (!available(USDT)) { return 0; } USDT.transfer(0x1234, 1); return pot.USDT; }",
    bytecode: "010001208ae1d1890520000000003100",
    derivedAccounts: {},
  },
];

describe("a branch a test rules out reaches none of the SDK's rewrites", () => {
  const cases = RULED_OUT.flatMap((entry) =>
    Object.entries(SPELLINGS).map(
      ([spelling, spell]) =>
        [
          `${entry.chain}, ${spelling}: ${spell(entry.available)}`,
          spell(entry.available),
          entry,
        ] as const,
    ),
  );
  it.each(cases)("%s", (_name, source, { chain, bytecode, derivedAccounts }) => {
    const program = compileSauceProgram(chain, source);
    expect(Buffer.from(program.bytecode).toString("hex")).toBe(bytecode);
    expect(program.derivedAccounts ?? {}).toEqual(derivedAccounts);
  });

  it("blanks it in place: every other character, and every line, where it was", () => {
    const source =
      "function main(): Uint256 {\n  if (UniswapV3.Factory) {\n    return pot.USDC;\n  }\n  return UniswapV3.Factory ? pot.USDC : 0;\n}\n";
    const { dead } = checkNames(source, chainNames(requireChain("solana")));
    expect(withoutDead(source, dead)).toBe(
      "function main(): Uint256 {\n  if (UniswapV3.Factory) {\n                    \n  }\n  return UniswapV3.Factory ? 0        : 0;\n}\n",
    );
  });
});
