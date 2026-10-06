/**
 * The tokenized stocks (`stock-tokens.ts`) as names a program uses: each compiles as a token global
 * on its own chain, a value and with the token methods, through the same symbol syntax as `USDC`
 * (on Solana, as the mint's key the `@sauce/token` functions take first); is refused, by name, on a
 * chain without it; and is declared everywhere a token symbol is (the source globals, the generated
 * SauceScript and chain-export declarations, the chain export).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, Ethereum, Solana } from "../src/index.js";
import { requireChain } from "../src/chains/canonical.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { TOKEN_2022_PROGRAM_ID } from "../src/svm/token-program.js";

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "routes");
const SPCXC = "0xb2000000000000000000007b9fcbd005511aCBd5";
const RECIPIENT = "0x00000000000000000000000000000000000000aA";
/** TSLAx's mint on Solana, as the 32-byte key a program holds it as. */
const TSLAX_KEY = "0x07e83582411fea1482f0994b80aa512a97c94f25df283bec5a67a381fc862b4a";

describe("stock tokens in a program", () => {
  // Pending the compiler: a compile-time method copies a called argument (`ctx.self()`) before its
  // body runs, and runs `@sauce/token`'s function in place when an argument is an instance.
  it.failing(
    "compile on Base as a value and with the token methods, the writes through @sauce/token",
    () => {
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
      // A write is the library's SafeERC20 one, as for any registry token: the same bytes as the
      // library's functions called with the token's address.
      const byHand = compileSauceProgram(
        "base",
        [
          'import { approve, balanceOf, transfer } from "@sauce/token";',
          "function main(amount: Uint256): Uint256 {",
          `  require(${SPCXC}n == ${SPCXC}n);`,
          `  require(balanceOf(${SPCXC}n, ctx.self()) >= 0n);`,
          `  transfer(${SPCXC}n, ${RECIPIENT}n, amount);`,
          `  approve(${SPCXC}n, ctx.self(), amount);`,
          `  return balanceOf(${SPCXC}n, ctx.self());`,
          "}",
        ].join("\n"),
      );
      expect(Buffer.from(program.bytecode)).toEqual(Buffer.from(byHand.bytecode));
    },
  );

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
    // Used there, a stock token is the chain's refusal; compared with zero, it is zero there.
    expect(() =>
      compileSauceProgram("ethereum", "function main() {\n  SPCXc.transfer(ctx.self(), 1n);\n}"),
    ).toThrow(/SPCXc/);
    expect(() =>
      compileSauceProgram("base", "function main() {\n  TSLAon.transfer(ctx.self(), 1n);\n}"),
    ).toThrow(/TSLAon/);
  });
});

describe("Solana's stock mints in a program", () => {
  it("compile on Solana as the mint's key: a balance and a checked transfer through @sauce/token", () => {
    const program = compileSauceProgram(
      "solana",
      [
        "function main(",
        "  tokenProgram: Account,",
        "  source: Account<Writable>,",
        "  mint: Account,",
        "  dest: Account<Writable>,",
        "  pot: Account<Signer>,",
        "  amount: Uint256,",
        "): Uint256 {",
        `  require(TSLAx == ${TSLAX_KEY}n);`,
        "  const before = balanceOf(TSLAx, dest);",
        "  transferChecked(TSLAx, tokenProgram, source, mint, dest, pot, amount, 8n);",
        "  return balanceOf(TSLAx, dest) - before;",
        "}",
      ].join("\n"),
    );
    expect(program.bytecode.length).toBeGreaterThan(0);
  });

  it("compile by each issuer's symbol: an Ondo mint, a renamed xStock, Backpack's and PreStocks'", () => {
    for (const symbol of ["TSLAon", "BRK_Bx", "NVDA_US", "SPACEX"]) {
      const program = compileSauceProgram(
        "solana",
        `function main(account: Account): Uint256 {\n  require(${symbol} != 0n);\n  return balanceOf(${symbol}, account);\n}`,
      );
      expect(program.bytecode.length).toBeGreaterThan(0);
      expect(registryTokenAddress(requireChain("solana"), symbol)).toBeDefined();
    }
  });

  it("are refused, by name, on a chain without them, and an EVM chain's on Solana", () => {
    // Compared with zero, an absent name is zero there; any other use is refused, naming it.
    expect(() =>
      compileSauceProgram("base", "function main(): Uint256 {\n  return NVDA_US;\n}"),
    ).toThrow(/NVDA_US/);
    expect(() =>
      compileSauceProgram("ethereum", "function main(): Uint256 {\n  return SPACEX;\n}"),
    ).toThrow(/SPACEX/);
    expect(() =>
      compileSauceProgram(
        "solana",
        "function main(account: Account): Uint256 {\n  return balanceOf(SPCXc, account);\n}",
      ),
    ).toThrow(/SPCXc/);
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

  it("are in Solana's sourceGlobals as Token-2022 mints, with their issuer, name and ticker", () => {
    expect(sourceGlobals("solana").tokens).toContainEqual({
      symbol: "SPCX_US",
      address: "0x06809edcbf7425ab33585dc91cbeece17a16fe14b0aa3db5e2e1795421ef8580",
      decimals: 6,
      mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      stock: { issuer: "backpack", name: "SpaceX", ticker: "SPCX" },
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
    // Solana's: a mint only Solana has is declared as a value, and its export carries the mint.
    for (const symbol of ["NVDA_US", "SPACEX"]) {
      expect(declarations).toContain(`const ${symbol}: bigint;`);
    }
    expect(tokensOf("Solana")).toContain('"TSLAx"');
    expect(tokensOf("Solana")).toContain('"SPACEX"');
    expect(tokensOf("Solana")).not.toContain('"SPCXc"');
    expect(Solana.TSLAx).toMatchObject({
      address: TSLAX_KEY,
      decimals: 8,
      symbol: "TSLAx",
      mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    });
  });
});
