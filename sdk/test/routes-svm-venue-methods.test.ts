/**
 * Solana's venue namespaces (`svm-venue-methods.ts`): `<Venue>.swap(…)` and `<Venue>.trySwap(…)`
 * lowered to that venue's own `@sauce/router` function, the pool's slot and the trader's accounts
 * added to `main` with how each is derived. Compiled through `compileSauceProgram` and the real
 * compiler; executed in `cli-solana-venues.e2e.test.ts`.
 */
import { getAddressCodec } from "@solana/kit";

import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { SVM_VENUE_NAMESPACES } from "../src/routes/svm-venue-methods.js";

const compile = (source: string) => compileSauceProgram("solana", source);
const SWAP =
  "function main(pool: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
  "  return OrcaWhirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n";

describe("Solana's venue namespaces", () => {
  it("lowers to the venue's own function, never trySwap, its slot and trader added to main", () => {
    const program = compile(SWAP);
    expect(program.source).toContain(
      'import { orcaWhirlpool as __sauce_orcaWhirlpool } from "@sauce/router";',
    );
    expect(program.source).toContain(
      "return __sauce_orcaWhirlpool([poolProgram, poolAccount, poolConfig, poolVaultA, poolVaultB, " +
        "poolExtra, poolTicks0, poolTicks1, poolTicks2], [pot, potUSDC, mintUSDC, mintWSOL, " +
        "tokenProgram, token2022Program, memoProgram], amountIn, maxPrice, 1, potWSOL);",
    );
    expect(program.derivedAccounts).toMatchObject({
      poolProgram: "slot:@pool:USDC.program",
      poolTicks2: "slot:@pool:USDC.ticks2",
      potUSDC: "self:USDC",
      potWSOL: "self:WSOL",
      memoProgram: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    });
    // The roles the router's swap needs: the pool, its vaults, extra and tick arrays writable.
    const roles = Object.fromEntries(
      program.manifest!.accounts.map((slot) => {
        const s = slot as { name: string; requires: string };
        return [s.name, s.requires];
      }),
    );
    expect(roles).toMatchObject({
      poolProgram: "readonly",
      poolAccount: "writable",
      poolConfig: "readonly",
      poolTicks0: "writable",
      pot: "readonly_signer",
      potUSDC: "writable",
      potWSOL: "writable",
    });
    // One venue's function is a fraction of trySwap's every venue.
    expect(program.bytecode.length).toBeLessThan(2_200);
    expect(program.source).not.toContain("trySwap");
  });

  it("names every venue a price limit stops, each to its own pair of functions", () => {
    for (const [namespace, venue] of Object.entries(SVM_VENUE_NAMESPACES)) {
      for (const method of ["swap", "trySwap"] as const) {
        const program = compile(
          `function main(pool: Address): Uint256 {\n  return ${namespace}.${method}(pool, USDC, WSOL, 5, 10, 1);\n}\n`,
        );
        const fn = method === "swap" ? venue.swap : venue.trySwap;
        expect(program.source).toContain(`import { ${fn} as __sauce_${fn} } from "@sauce/router";`);
      }
    }
  });

  it("forwards what arrived with the token methods, the accounts shared between them", () => {
    const program = compile(
      "function main(pool: Address, to: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  const got = RaydiumClmm.trySwap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n" +
        "  if (got > 0) WSOL.transfer(to, got);\n" +
        "  return got;\n}\n",
    );
    expect(program.source).toContain(
      "__sauce_transfer(WSOL, tokenProgram, potWSOL, toWSOL, pot, got)",
    );
    // The Pot, its WSOL account and the token program are one account each, used by both calls.
    const names = program.manifest!.accounts.map((slot) => (slot as { name: string }).name);
    expect(names.filter((name) => name === "potWSOL")).toHaveLength(1);
    expect(names).toContain("toWSOL");
  });

  it("takes a pool written out as a key, and a token by its mint", () => {
    const key = `0x${"77".repeat(32)}`;
    const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0x77));
    const program = compile(
      `function main(mint: Address): Uint256 {\n  return Phoenix.trySwap(${key}, USDC, mint, 5, 10, 1);\n}\n`,
    );
    expect(program.derivedAccounts).toMatchObject({
      pool1Program: `slot:${base58}:USDC.program`,
      mintAccount: "mint:@mint",
      potMint: "self:@mint",
    });
  });

  describe("refusals", () => {
    it("a pool computed as the program runs", () => {
      expect(() =>
        compile(
          "function main(): Uint256 {\n  const pool = 5;\n  return OrcaWhirlpool.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n",
        ),
      ).toThrow("the pool `pool` on Solana must be known when the transaction is built");
    });

    it("a method the namespace does not have, a wrong count of arguments, one token both ways", () => {
      expect(() =>
        compile("function main(pool: Address) {\n  OrcaWhirlpool.quote(pool);\n}\n"),
      ).toThrow("`OrcaWhirlpool.quote(…)` on Solana: OrcaWhirlpool offers swap and trySwap");
      expect(() =>
        compile(
          "function main(pool: Address): Uint256 {\n  return Crema.swap(pool, USDC, WSOL);\n}\n",
        ),
      ).toThrow(
        "`Crema.swap(…)` takes 6 arguments (pool, tokenIn, tokenOut, amountIn, maxPrice, minOut), got 3.",
      );
      expect(() =>
        compile(
          "function main(pool: Address): Uint256 {\n  return Crema.swap(pool, USDC, USDC, 1, 1, 1);\n}\n",
        ),
      ).toThrow("pays and buys the same token, USDC");
    });

    it("a swap in a helper: its accounts are main's", () => {
      expect(() =>
        compile(
          "function buy(pool: Address): Uint256 {\n  return Byreal.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n" +
            "function main(pool: Address): Uint256 {\n  return buy(pool);\n}\n",
        ),
      ).toThrow(
        "`Byreal.swap(…)` on Solana stands in `buy`: the accounts a venue's swap moves through",
      );
    });
  });

  it("leaves a program that declares the namespace itself as it is", () => {
    const own =
      "function OrcaWhirlpool(x: Uint256): Uint256 {\n  return x;\n}\nfunction main(): Uint256 {\n  return OrcaWhirlpool(1);\n}\n";
    expect(compile(own).derivedAccounts).toBeUndefined();
  });
});
