/**
 * Token names in a program: a registered symbol (`USDC`) and `Token(address)` are values of the
 * `Token` type the chain's host declares (`src/routes/host.ts`). Its writes are `@sauce/token`'s
 * SafeERC20 functions with the token first — `USDC.transfer(to, amount)` is `transfer(USDC, to,
 * amount)` — its `balanceOf` is the library's read, and `holder.USDC` is the holder's balance. The
 * program's text is never rewritten: each case is held to the program the same calls written by
 * hand compile to.
 */
import { requireChain } from "../src/chains/canonical.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";
import { registryTokenAddress, SVM_TOKEN_REGISTRY } from "../src/routes/token-registry.js";

// Base USDC -- pinned fixture, matching src/verify/vectors.ts's own Base USDC constant.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const TO = "0x6666666666666666666666666666666666666666" as const;
const HOLDER = "0x1111111111111111111111111111111111111122" as const;

const bytesOf = (chain: string, source: string, options = {}): number[] =>
  Array.from(
    compileSauceRoute(chain, source, { pot: POT, engine: ENGINE }, options).compiled.bytecode[0]!,
  );

/** The same calls, spelled as direct `@sauce/token` calls against literal addresses. */
const library = (chain: string, imports: string, body: string): number[] =>
  bytesOf(chain, `import { ${imports} } from "@sauce/token";\nfunction main() { ${body} }`);

function execution() {
  return { pot: POT, engine: ENGINE };
}

describe("a token symbol's writes are @sauce/token's, the token first", () => {
  it.each([
    ["transfer", `${TO}, 5n`],
    ["approve", `${TO}, 5n`],
    ["transferFrom", `${TO}, ${TO}, 5n`],
  ])("USDC.%s compiles to the same bytes as the direct @sauce/token call", (write, args) => {
    expect(bytesOf("base", `USDC.${write}(${args});`)).toEqual(
      library("base", write, `${write}(${USDC}, ${args});`),
    );
  });

  it("every write in one program, against the library's calls in one program", () => {
    expect(
      bytesOf(
        "base",
        `function main() { USDC.approve(${TO}, 1n); USDC.transfer(${TO}, 2n); USDC.transferFrom(${TO}, ${TO}, 3n); }`,
      ),
    ).toEqual(
      library(
        "base",
        "approve, transfer, transferFrom",
        `approve(${USDC}, ${TO}, 1n); transfer(${USDC}, ${TO}, 2n); transferFrom(${USDC}, ${TO}, ${TO}, 3n);`,
      ),
    );
  });

  it("a write whose result is used is refused: SafeERC20 returns nothing", () => {
    expect(() =>
      bytesOf(
        "base",
        `function main(): Uint256 { const ok = USDC.transfer(${TO}, 5n); return ok; }`,
      ),
    ).toThrow(/`undefined` exists only while the program compiles/);
  });

  it("a write with the wrong arguments is refused, naming the method", () => {
    expect(() => bytesOf("base", `function main() { USDC.transfer(${TO}); }`)).toThrow(/transfer/);
  });

  it("a missing argument is refused as unset, at the program's call", () => {
    let caught: unknown;
    try {
      bytesOf("base", `function main() { USDC.transfer(${TO}); }`);
    } catch (error) {
      caught = error;
    }
    const [diagnostic] = (
      caught as {
        diagnostics: { code: string; message: string; path: string; start: { column: number } }[];
      }
    ).diagnostics;
    // The library's parameter is annotated, so `undefined` reaching it is refused there, and the
    // refusal is placed on the program's own call, not inside the library.
    expect(diagnostic).toMatchObject({ code: "Unset", path: "main.js" });
    expect(diagnostic!.message).toBe("`amount` is `undefined`, so it has no run-time value here");
    expect(String((caught as Error).message)).not.toContain("`toBytesBe` is not a member");
  });

  it("a method the type does not have is refused", () => {
    expect(() => bytesOf("base", `function main() { USDC.aproove(${TO}, 5n); }`)).toThrow(
      /aproove/,
    );
  });

  it("a program's own `transfer` is its own, beside USDC.transfer", () => {
    const out = bytesOf(
      "base",
      `function transfer(a: Uint256): Uint256 { return a; }\nfunction main(): Uint256 { USDC.transfer(${TO}, 5n); return transfer(1n); }`,
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it("an explicit IERC20.at(x).transfer(...) is the raw ABI call, not the library's", () => {
    const raw = bytesOf(
      "base",
      `import IERC20 from "./artifacts/IERC20.json";\nfunction main() { IERC20.at(USDC).transfer(${TO}, 5n); }`,
    );
    expect(raw).not.toEqual(bytesOf("base", `USDC.transfer(${TO}, 5n);`));
  });

  it("a program that binds `USDC` owns the name", () => {
    expect(
      bytesOf("base", "function main(): Uint256 { let USDC = 1n; return USDC + 1n; }"),
    ).toEqual(bytesOf("base", "function main(): Uint256 { let x = 1n; return x + 1n; }"));
  });

  it("balanceOf is the library's read", () => {
    expect(
      bytesOf("base", `function main(): Uint256 { return USDC.balanceOf(${HOLDER}); }`),
    ).toEqual(
      bytesOf(
        "base",
        `import { balanceOf } from "@sauce/token";\nfunction main(): Uint256 { return balanceOf(${USDC}, ${HOLDER}); }`,
      ),
    );
  });
});

describe("a symbol resolves through the chain's registry", () => {
  it("compiles USDC.transfer(...) as a route with one cook() call", () => {
    const route = compileSauceRoute("base", `USDC.transfer(${TO}, 5n);`, execution());
    expect(route.calls).toHaveLength(1);
  });

  it("options.tokens OVERRIDES the registry, per key", () => {
    const other = "0x7777777777777777777777777777777777777777";
    expect(bytesOf("base", `USDC.transfer(${TO}, 5n);`, { tokens: { USDC: other } })).toEqual(
      library("base", "transfer", `transfer(${other}, ${TO}, 5n);`),
    );
  });

  it("a chain whose registry lacks the symbol refuses it, saying so", () => {
    // Ethereum registers USDT; Base does not.
    expect(() => bytesOf("base", `USDT.transfer(${TO}, 5n);`)).toThrow(
      /`USDT` is not a token or protocol on base/,
    );
  });

  it("chain-scoped: Base's USDC is not Ethereum's", () => {
    expect(bytesOf("ethereum", `USDC.transfer(${TO}, 5n);`)).toEqual(
      library("ethereum", "transfer", `transfer(${ETHEREUM_USDC}, ${TO}, 5n);`),
    );
    expect(bytesOf("ethereum", `USDC.transfer(${TO}, 5n);`)).not.toEqual(
      bytesOf("base", `USDC.transfer(${TO}, 5n);`),
    );
  });
});

describe("USDT0: Tether's token on the chains whose USDT is USDT0", () => {
  const usdt0Of = (slug: string) =>
    `0x${registryTokenAddress(requireChain(slug), "USDT0")!.toString(16).padStart(40, "0")}`;

  it.each(["arbitrum", "polygon"])(
    "on %s, USDT0.transfer is @sauce/token's SafeERC20 transfer of the registry's USDT0",
    (slug) => {
      expect(bytesOf(slug, `USDT0.transfer(${TO}, 5n);`)).toEqual(
        library(slug, "transfer", `transfer(${usdt0Of(slug)}, ${TO}, 5n);`),
      );
    },
  );

  it.each(["arbitrum", "polygon"])("on %s, IERC20.at(USDT0) reads the token", (slug) => {
    const read = `import { IERC20 } from "./artifacts/IERC20.json";\nfunction main(): Uint256 { return IERC20.at(USDT0).balanceOf(${TO}); }`;
    expect(bytesOf(slug, read).length).toBeGreaterThan(0);
  });

  it("is refused by name on a chain that has none, and USDT where the token is USDT0", () => {
    expect(() => bytesOf("base", `USDT0.transfer(${TO}, 5n);`)).toThrow(
      /`USDT0` is not a token or protocol on base/,
    );
    expect(() => bytesOf("arbitrum", `USDT.transfer(${TO}, 5n);`)).toThrow(
      /`USDT` is not a token or protocol on arbitrum/,
    );
  });
});

describe("self.USDC is the running contract's balance", () => {
  it("self.USDC is balanceOf(USDC, ctx.self())", () => {
    expect(bytesOf("base", "function main(): Uint256 { return self.USDC; }")).toEqual(
      bytesOf(
        "base",
        `import { balanceOf } from "@sauce/token";\nfunction main(): Uint256 { return balanceOf(${USDC}, ctx.self()); }`,
      ),
    );
  });

  it("USDC.balanceOf(self) is the same read", () => {
    expect(bytesOf("base", "function main(): Uint256 { return self.USDC; }")).toEqual(
      bytesOf("base", "function main(): Uint256 { return USDC.balanceOf(self); }"),
    );
  });
});

describe("Token(address) is any address as a token", () => {
  it.each([
    ["transfer", `${TO}, 5n`],
    ["approve", `${TO}, 5n`],
    ["transferFrom", `${TO}, ${TO}, 5n`],
  ])("Token(addr).%s compiles to the direct @sauce/token call", (write, args) => {
    expect(bytesOf("base", `Token(${USDC}).${write}(${args});`)).toEqual(
      library("base", write, `${write}(${USDC}, ${args});`),
    );
  });

  it("a bound Token(...) is the same token, by name", () => {
    expect(bytesOf("base", `const t = Token(${USDC});\nt.transfer(${TO}, 5n);`)).toEqual(
      bytesOf("base", `Token(${USDC}).transfer(${TO}, 5n);`),
    );
  });

  it("Token(USDC) of a symbol is the symbol", () => {
    expect(bytesOf("base", `Token(USDC).transfer(${TO}, 5n);`)).toEqual(
      bytesOf("base", `USDC.transfer(${TO}, 5n);`),
    );
  });

  it("a program that declares its own `Token` owns the name", () => {
    expect(
      bytesOf(
        "base",
        "function Token(x: Uint256): Uint256 { return x; }\nfunction main(): Uint256 { return Token(1n); }",
      ),
    ).not.toEqual(bytesOf("base", `Token(${USDC}).transfer(${TO}, 5n);`));
  });
});

describe("svm: a token symbol is the mint's key", () => {
  const solana = (source: string) => Array.from(compileSauceProgram("solana", source).bytecode);

  it("a bare registered symbol is a value the program compiles with", () => {
    const [usdc] = SVM_TOKEN_REGISTRY["mainnet-beta"].filter((row) => row.symbol === "USDC");
    expect(usdc).toBeDefined();
    expect(solana("function main(): Uint256 { return USDC; }").length).toBeGreaterThan(0);
  });

  it("it has no token methods: an SPL write needs the accounts a symbol does not carry", () => {
    expect(() => solana(`function main() { USDC.transfer(${TO}, 5n); }`)).toThrow();
  });

  it("there is no Token(address) on Solana", () => {
    expect(() => solana(`function main() { Token(${USDC}).transfer(${TO}, 5n); }`)).toThrow(
      /Token/,
    );
  });

  it("requires the svm chain to be Solana's", () => {
    expect(requireChain("solana").kind).toBe("svm");
  });
});
