/**
 * The tokenized stocks (`stock-tokens.ts`) as names a program uses: each compiles as a token global
 * on its own chain, a value and with the token methods, through the same symbol syntax as `USDC`;
 * is refused, by name, on a chain without it; and is declared everywhere a token symbol is (the
 * source globals, the generated SauceScript and chain-export declarations, the chain export).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, Ethereum } from "../src/index.js";
import { requireChain } from "../src/chains/canonical.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "routes");
const SPCXC = "0xb2000000000000000000007b9fcbd005511aCBd5";
const RECIPIENT = "0x00000000000000000000000000000000000000aA";

describe("stock tokens in a program", () => {
  it("compile on Base as a value and with the token methods, the writes through @sauce/token", () => {
    const program = compileSauceProgram(
      "base",
      [
        "function main(amount: Uint256): Uint256 {",
        `  require(SPCXc == ${SPCXC}n);`,
        "  require(Token(SPCXc).balanceOf(ctx.self()) >= 0n);",
        `  SPCXc.transfer(${RECIPIENT}n, amount);`,
        "  SPCXc.approve(ctx.self(), amount);",
        "  return SPCXc.balanceOf(ctx.self());",
        "}",
      ].join("\n"),
    );
    expect(program.bytecode.length).toBeGreaterThan(0);
    // A write is the library's SafeERC20 one, as for any registry token.
    expect(program.source).toMatch(
      /import \{ transfer as __sauce_transfer\b.*\} from "@sauce\/token"/,
    );
    expect(program.source).toContain("__sauce_transfer(SPCXc,");
    expect(program.source).toContain("__sauce_approve(SPCXc,");
  });

  it("compile on Ethereum by the issuer's ticker: an Ondo token, a renamed xStock, a bToken", () => {
    for (const symbol of ["TSLAon", "SPCXx", "BRK_Bx", "bTSLA"]) {
      const program = compileSauceProgram(
        "ethereum",
        `function main(): Uint256 {\n  require(${symbol} != 0n);\n  return ${symbol}.balanceOf(ctx.self());\n}`,
      );
      expect(program.bytecode.length).toBeGreaterThan(0);
      expect(registryTokenAddress(requireChain("ethereum"), symbol)).toBeDefined();
    }
  });

  it("are refused, by name, on a chain without them", () => {
    expect(() =>
      compileSauceProgram("ethereum", "function main() {\n  require(SPCXc != 0n);\n}"),
    ).toThrow(/SPCXc/);
    expect(() =>
      compileSauceProgram("base", "function main() {\n  require(TSLAon != 0n);\n}"),
    ).toThrow(/TSLAon/);
  });
});

describe("stock tokens wherever a token symbol is declared", () => {
  it("are in sourceGlobals, with their issuer, name and ticker", () => {
    expect(sourceGlobals("base").tokens).toContainEqual({
      symbol: "SPCXc",
      address: SPCXC,
      decimals: 8,
      stock: { issuer: "coinbase", name: "Space Exploration Technologies Corp.", ticker: "SPCX" },
    });
  });

  it("are declared as SauceScript token globals and on their chain's export", () => {
    const declarations = readFileSync(join(ROUTES, "source-globals.generated.ts"), "utf-8");
    for (const symbol of ["SPCXc", "TSLAon", "BRK_Bx", "bTSLA"]) {
      expect(declarations).toContain(`const ${symbol}: bigint & SauceTokenSource;`);
    }
    const exports = readFileSync(join(ROUTES, "chain-exports.generated.ts"), "utf-8");
    const tokensOf = (name: string) =>
      new RegExp(`export const ${name} = [^\\n]*Tokens<([^>]*)>`).exec(exports)![1]!;
    expect(tokensOf("Base")).toContain('"SPCXc"');
    expect(tokensOf("Ethereum")).toContain('"BRK_Bx"');
    expect(tokensOf("Base")).not.toContain('"TSLAon"');
    expect(Base.SPCXc).toMatchObject({ address: SPCXC, decimals: 8, symbol: "SPCXc" });
    expect(Ethereum.SPCXon.decimals).toBe(18);
  });
});
