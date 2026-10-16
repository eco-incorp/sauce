/**
 * Solana's venue namespaces (`svm-venue-methods.ts`): `<Protocol>.<Program>.swap(…)` (`Orca.Whirlpool`)
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
  "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n}\n";

describe("Solana's venue namespaces", () => {
  it("lowers to the venue's own function, never swap, its slot and trader added to main", () => {
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
    // One venue's function is a fraction of swap's every venue.
    expect(program.bytecode.length).toBeLessThan(2_200);
    expect(program.source).not.toContain("{ swap as");
  });

  it("names every venue, its protocol then its program, each to its function", () => {
    expect(Object.keys(SVM_VENUE_NAMESPACES).sort()).toEqual(
      [
        "Byreal.CLMM",
        "Crema.CLMM",
        "Cropper.Whirlpool",
        "Defituna.Fusion",
        "Meteora.DLMM",
        "Orca.Whirlpool",
        "Pancakeswap.CLMM",
        "Phoenix.Market",
        "Raydium.CLMM",
        "Stabble.CLMM",
      ].sort(),
    );
    for (const [namespace, venue] of Object.entries(SVM_VENUE_NAMESPACES)) {
      // Meteora DLMM's swap is an exact input: no maxPrice.
      const price = venue.exact ? "" : "10, ";
      const program = compile(
        `function main(pool: Address): Uint256 {\n  return ${namespace}.swap(pool, USDC, WSOL, 5, ${price}1);\n}\n`,
      );
      expect(program.source).toContain(
        `import { ${venue.swap} as __sauce_${venue.swap} } from "@sauce/router";`,
      );
    }
  });

  it("forwards what arrived with the token methods, the accounts shared between them", () => {
    const program = compile(
      "function main(pool: Address, to: Address, amountIn: Uint256, maxPrice: Uint256): Uint256 {\n" +
        "  const got = Raydium.CLMM.swap(pool, USDC, WSOL, amountIn, maxPrice, 1);\n" +
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
      `function main(mint: Address): Uint256 {\n  return Phoenix.Market.swap(${key}, USDC, mint, 5, 10, 1);\n}\n`,
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
          "function main(): Uint256 {\n  const pool = 5;\n  return Orca.Whirlpool.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n",
        ),
      ).toThrow("the pool `pool` on Solana must be known when the transaction is built");
    });

    it("a method or a program the namespace does not have, a wrong count of arguments, one token both ways", () => {
      expect(() =>
        compile("function main(pool: Address) {\n  Orca.Whirlpool.trySwap(pool);\n}\n"),
      ).toThrow(
        "`Orca.Whirlpool.trySwap(…)` on Solana: Orca.Whirlpool offers swap, taking (pool, tokenIn, " +
          "tokenOut, amountIn, maxPrice, minOut): it returns 0 having moved nothing where the pool " +
          "cannot trade, and reverts below minOut",
      );
      expect(() =>
        compile(
          "function main(pool: Address) {\n  Orca.Splash.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n",
        ),
      ).toThrow("`Orca.Splash.swap(…)` on Solana: Orca's swap is Orca.Whirlpool");
      expect(() =>
        compile(
          "function main(pool: Address) {\n  Solana.trySwap(pool, USDC, WSOL, 1, 1, 1);\n}\n",
        ),
      ).toThrow("`Solana.trySwap(…)` on Solana: Solana.swap is the one swap");
      expect(() =>
        compile(
          "function main(pool: Address): Uint256 {\n  return Crema.CLMM.swap(pool, USDC, WSOL);\n}\n",
        ),
      ).toThrow(
        "`Crema.CLMM.swap(…)` takes 6 arguments (pool, tokenIn, tokenOut, amountIn, maxPrice, minOut), got 3.",
      );
      expect(() =>
        compile(
          "function main(pool: Address): Uint256 {\n  return Crema.CLMM.swap(pool, USDC, USDC, 1, 1, 1);\n}\n",
        ),
      ).toThrow("pays and buys the same token, USDC");
    });

    it("a swap in a helper: its accounts are main's", () => {
      expect(() =>
        compile(
          "function buy(pool: Address): Uint256 {\n  return Byreal.CLMM.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n" +
            "function main(pool: Address): Uint256 {\n  return buy(pool);\n}\n",
        ),
      ).toThrow(
        "`Byreal.CLMM.swap(…)` on Solana stands in `buy`: the accounts a venue's swap moves through",
      );
    });
  });

  it("Solana.swap takes a pool of any venue: the router's own swap, reading it", () => {
    const program = compile(
      "function main(pool: Address): Uint256 {\n  return Solana.swap(pool, USDC, WSOL, 5, 10, 1);\n}\n",
    );
    expect(program.source).toContain('import { swap as __sauce_swap } from "@sauce/router";');
    expect(program.derivedAccounts).toMatchObject({
      poolProgram: "slot:@pool:USDC.program",
      poolAccount: "slot:@pool:USDC.pool",
      potWSOL: "self:WSOL",
    });
    // Two pools, one trader: each pool its own nine, the Pot's accounts shared.
    const two = compile(
      "function main(a: Address, b: Address): Uint256 {\n" +
        "  return Solana.swap(a, USDC, WSOL, 5, 10, 0) + Solana.swap(b, USDC, WSOL, 5, 10, 0);\n}\n",
    );
    const names = two.manifest!.accounts.map((slot) => (slot as { name: string }).name);
    expect(names.filter((name) => name.startsWith("a") || name.startsWith("b"))).toHaveLength(18);
    expect(names.filter((name) => name === "potUSDC")).toHaveLength(1);
    // The chain's other members are left to the account expressions.
    const pda = compile(
      'function main(): Uint256 {\n  const state = Solana.pda(Solana.systemProgram, ["s"]);\n  return state.dataLen;\n}\n',
    );
    expect(pda.derivedAccounts).toMatchObject({ statePda: expect.stringMatching(/^pda:/) });
  });

  it("leaves a program that declares the namespace itself as it is", () => {
    const own =
      "function Orca(x: Uint256): Uint256 {\n  return x;\n}\nfunction main(): Uint256 {\n  return Orca(1);\n}\n";
    expect(compile(own).derivedAccounts).toBeUndefined();
  });
});
