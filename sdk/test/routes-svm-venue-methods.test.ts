/**
 * Solana's venue namespaces (`svm-venue-methods.ts`): `<Protocol>.<Program>.swap(…)` (`Orca.Whirlpool`)
 * lowered to that venue's own `@sauce/router` function, the pool's slot and the trader's accounts
 * added to `main` with how each is derived; its pool found by key (`Orca.Whirlpool.pool(USDC, WSOL,
 * 4)`), and a loop over keys written out once per key. Compiled through `compileSauceProgram` and
 * the real compiler; executed in `cli-solana-venues.e2e.test.ts` and the distributed swap's suites.
 */
import { getAddressCodec } from "@solana/kit";

import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { SVM_VENUE_NAMESPACES } from "../src/routes/svm-venue-methods.js";

const compile = (source: string) => compileSauceProgram("solana", source);
const SWAP =
  "function main(pool: Address, amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
  "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, priceLimit, 1);\n}\n";

describe("Solana's venue namespaces", () => {
  it("lowers to the venue's own function, its slot and trader added to main", () => {
    const program = compile(SWAP);
    expect(program.source).toContain(
      'import { orcaWhirlpool as __sauce_orcaWhirlpool } from "@sauce/router";',
    );
    expect(program.source).toContain(
      "return __sauce_orcaWhirlpool([poolProgram, poolAccount, poolConfig, poolVaultA, poolVaultB, " +
        "poolExtra, poolTicks0, poolTicks1, poolTicks2], [pot, potUSDC, mintUSDC, mintWSOL, " +
        "tokenProgram, token2022Program, memoProgram], amountIn, priceLimit, 1, potWSOL);",
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
    expect(program.bytecode.length).toBeLessThan(2_200);
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
      // Meteora DLMM's swap is an exact input: no priceLimit.
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
      "function main(pool: Address, to: Address, amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
        "  const got = Raydium.CLMM.swap(pool, USDC, WSOL, amountIn, priceLimit, 1);\n" +
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
        "`Orca.Whirlpool.trySwap(…)` on Solana: Orca.Whirlpool offers swap and pool, swap taking " +
          "(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut): it returns 0 having moved " +
          "nothing where the pool cannot trade, and reverts below minOut",
      );
      expect(() =>
        compile(
          "function main(pool: Address) {\n  Orca.Splash.swap(pool, USDC, WSOL, 1, 1, 1);\n}\n",
        ),
      ).toThrow("`Orca.Splash.swap(…)` on Solana: Orca's swap is Orca.Whirlpool");
      expect(() =>
        compile(
          "function main(pool: Address): Uint256 {\n  return Crema.CLMM.swap(pool, USDC, WSOL);\n}\n",
        ),
      ).toThrow(
        "`Crema.CLMM.swap(…)` takes 6 arguments (pool, tokenIn, tokenOut, amountIn, priceLimit, minOut), got 3.",
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

  it("finds a pool by key, as an EVM factory's getPool: its slot derived from the pair and key", () => {
    const program = compile(
      "function main(amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
        "  return Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0)\n" +
        "    + Raydium.CLMM.swap(Raydium.CLMM.pool(WSOL, USDC, 400), USDC, WSOL, amountIn, priceLimit, 0);\n}\n",
    );
    expect(program.derivedAccounts).toMatchObject({
      orcaWhirlpool4Program: "slot:Orca.Whirlpool(USDC,WSOL,4):USDC.program",
      orcaWhirlpool4Account: "slot:Orca.Whirlpool(USDC,WSOL,4):USDC.pool",
      orcaWhirlpool4Ticks2: "slot:Orca.Whirlpool(USDC,WSOL,4):USDC.ticks2",
      raydiumClmm400Account: "slot:Raydium.CLMM(WSOL,USDC,400):USDC.pool",
      potUSDC: "self:USDC",
    });
    // No pool argument: the pools are the program's own.
    expect(program.entryParams.map((param) => param.name)).toEqual(["amountIn", "priceLimit"]);
    // A fee two configs charge takes the tick spacing after it.
    const spaced = compile(
      "function main(): Uint256 {\n" +
        "  return Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, 100, 1), USDC, WSOL, 5, 10, 0);\n}\n",
    );
    expect(spaced.derivedAccounts).toMatchObject({
      raydiumClmm100x1Account: "slot:Raydium.CLMM(USDC,WSOL,100,1):USDC.pool",
    });
  });

  it("writes a loop over keys out once per key, each key's pool its own slot", () => {
    const program = compile(
      "function main(priceLimit: Uint256): Uint256 {\n" +
        "  let bought = 0;\n" +
        "  for (const spacing of [1, 4, 64]) {\n" +
        "    bought += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, spacing), USDC, WSOL, self.USDC, priceLimit, 0);\n" +
        "  }\n" +
        "  return bought;\n}\n",
    );
    for (const spacing of [1, 4, 64]) {
      expect(program.source).toContain(`if (true) { const spacing = ${spacing};`);
      expect(program.derivedAccounts![`orcaWhirlpool${spacing}Account`]).toBe(
        `slot:Orca.Whirlpool(USDC,WSOL,${spacing}):USDC.pool`,
      );
    }
    expect(program.source).not.toContain("for (");
    // A loop whose body takes continue stays a loop, of one key each; nested loops each written out.
    const skipping = compile(
      "function main(): Uint256 {\n  let t = 0;\n  for (const s of [1, 4]) {\n" +
        "    if (t > 5) continue;\n" +
        "    for (const f of [400]) {\n" +
        "      t += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, s), USDC, WSOL, 5, 10, 0)\n" +
        "        + Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, f), USDC, WSOL, 5, 10, 0);\n" +
        "    }\n  }\n  return t;\n}\n",
    );
    // A body of one statement, with no braces, is written out the same way.
    const bare = compile(
      "function main(): Uint256 {\n  let t = 0;\n" +
        "  for (const s of [4, 1]) t += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, s), USDC, WSOL, 5, 10, 0);\n" +
        "  return t;\n}\n",
    );
    expect(Object.values(bare.derivedAccounts!)).toEqual(
      expect.arrayContaining([
        "slot:Orca.Whirlpool(USDC,WSOL,4):USDC.pool",
        "slot:Orca.Whirlpool(USDC,WSOL,1):USDC.pool",
      ]),
    );
    expect(skipping.source).toContain("for (const s of [1]) {");
    expect(skipping.source).toContain("for (const s of [4]) {");
    expect(skipping.source).toContain("if (true) { const f = 400;");
    expect(Object.values(skipping.derivedAccounts!)).toEqual(
      expect.arrayContaining([
        "slot:Orca.Whirlpool(USDC,WSOL,1):USDC.pool",
        "slot:Orca.Whirlpool(USDC,WSOL,4):USDC.pool",
        "slot:Raydium.CLMM(USDC,WSOL,400):USDC.pool",
      ]),
    );
  });

  describe("refusals of a pool by key", () => {
    const swapAt = (pool: string, body = "") =>
      compile(
        `function main(k: Uint256): Uint256 {\n${body}  return Orca.Whirlpool.swap(${pool}, USDC, WSOL, 5, 10, 1);\n}\n`,
      );

    it("a pool anywhere but a swap's, another venue's, another pair's, a market's", () => {
      expect(() =>
        compile(
          "function main(): Uint256 {\n  const p = Orca.Whirlpool.pool(USDC, WSOL, 4);\n  return 0;\n}\n",
        ),
      ).toThrow(
        "`Orca.Whirlpool.pool(…)` on Solana names the pool a swap trades at, found when the " +
          "transaction is built: write it as the pool of `Orca.Whirlpool.swap(…)`, its first argument.",
      );
      expect(() => swapAt("Raydium.CLMM.pool(USDC, WSOL, 400)")).toThrow(
        "`Orca.Whirlpool.swap(…)` trades at a pool of Orca.Whirlpool's, and " +
          "`Raydium.CLMM.pool(USDC, WSOL, 400)` is Raydium.CLMM's",
      );
      expect(() => swapAt("Orca.Whirlpool.pool(USDC, USDT, 4)")).toThrow(
        "`Orca.Whirlpool.pool(USDC, USDT, 4)` is a pool of USDC and USDT, and " +
          "`Orca.Whirlpool.swap(…)` pays USDC for WSOL",
      );
      expect(() =>
        compile(
          "function main(): Uint256 {\n  return Phoenix.Market.swap(Phoenix.Market.pool(USDC, WSOL, 1), USDC, WSOL, 5, 10, 1);\n}\n",
        ),
      ).toThrow("Phoenix's markets are not found by key");
      expect(() => swapAt("Orca.Whirlpool.pool(USDC, WSOL)")).toThrow(
        "`Orca.Whirlpool.pool(…)` takes 3 arguments (tokenA, tokenB, tickSpacing), got 2.",
      );
    });

    it("a key not written out, or not one the venue has", () => {
      expect(() => swapAt("Orca.Whirlpool.pool(USDC, WSOL, k)")).toThrow(
        "its tickSpacing must be known when the program compiles",
      );
      expect(() => swapAt("Orca.Whirlpool.pool(USDC, WSOL, 0)")).toThrow(
        "Orca.Whirlpool's key is a tick spacing, from 1 to 65535, and 0 is not one",
      );
      expect(() =>
        compile(
          "function main(): Uint256 {\n  return Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, 123), USDC, WSOL, 5, 10, 1);\n}\n",
        ),
      ).toThrow(
        "Raydium.CLMM's key is a pool's fee, in millionths (400 is 0.04%), and it has no config at 123",
      );
      expect(() =>
        compile(
          "function main(): Uint256 {\n  return Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, 100, 60), USDC, WSOL, 5, 10, 1);\n}\n",
        ),
      ).toThrow("Raydium.CLMM's configs at fee 100 have tick spacing 10 and 1, not 60");
      expect(() => swapAt("Orca.Whirlpool.pool(USDC, WSOL, 4, 4)")).toThrow(
        "`Orca.Whirlpool.pool(…)` takes 3 arguments (tokenA, tokenB, tickSpacing), got 4.",
      );
    });

    it("a loop over keys whose body declares its variable again", () => {
      expect(() =>
        compile(
          "function main(): Uint256 {\n  let t = 0;\n  for (const s of [1, 4]) {\n" +
            "    const s = 8;\n" +
            "    t += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, s), USDC, WSOL, 5, 10, 0);\n" +
            "  }\n  return t;\n}\n",
        ),
      ).toThrow("the loop over s declares s again in its body");
    });

    it("a loop over keys that breaks out of it, or is labelled", () => {
      const loop = (head: string, exit: string) =>
        compile(
          `function main(): Uint256 {\n  let t = 0;\n  ${head}for (const s of [1, 4]) {\n` +
            "    t += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, s), USDC, WSOL, 5, 10, 0);\n" +
            `    ${exit}\n  }\n  return t;\n}\n`,
        );
      expect(() => loop("", "if (t > 0) break;")).toThrow(
        "the loop over s breaks out of it: a loop over pool keys is written out once per key",
      );
      expect(() => loop("keys: ", "")).toThrow("the loop over s is labelled");
    });
  });

  it("keeps the chain's own members to the account expressions", () => {
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
