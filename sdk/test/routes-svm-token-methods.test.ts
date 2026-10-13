/**
 * The token syntax on Solana (`svm-token-rewrite.ts`): each call lowered to `@sauce/token`'s SVM arm,
 * the accounts it takes added to `main` with how each is derived, and each holder's account checked
 * on chain. Compiled through `compileSauceProgram` and the real compiler; executed in
 * `cli-solana-token-methods.e2e.test.ts`.
 */
import { getAddressCodec } from "@solana/kit";

import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { rewriteSvmTokenSyntax } from "../src/routes/svm-token-rewrite.js";
import { resolveTokenMap, svmTokenRows } from "../src/routes/token-registry.js";
import { requireChain } from "../src/chains/canonical.js";

const SOLANA = requireChain("solana");
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const compile = (source: string, defines?: Record<string, bigint>) =>
  compileSauceProgram("solana", source, defines === undefined ? {} : { defines });

const lower = (source: string) =>
  rewriteSvmTokenSyntax(source, resolveTokenMap(SOLANA), svmTokenRows(SOLANA));

describe("the token methods on Solana", () => {
  it("USDC.transfer(to, amount): the legacy transfer, its accounts added to main, the recipient checked", () => {
    const program = compile(
      "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
    );
    expect(program.source).toBe(
      'import { transfer as __sauce_transfer } from "@sauce/token";\n' +
        "function main(to: Address, amount: Uint256, tokenProgram: Account, pot: Account<Signer>, potUSDC: Account<Writable>, toUSDC: Account<Writable>) {\n" +
        "  __sauce_transfer(USDC, tokenProgram, potUSDC, toUSDC, pot, amount);" +
        ' require(svm.sload(toUSDC, 32, 32).toBe() == to, "wrong recipient account");\n' +
        "}\n",
    );
    expect(program.derivedAccounts).toEqual({
      tokenProgram: TOKEN_PROGRAM,
      pot: "self",
      potUSDC: "self:USDC",
      toUSDC: "@to:USDC",
    });
    // The added accounts are slots, in the order they are named; main's arguments are its own.
    expect(program.manifest!.accounts.map((slot) => (slot as { name: string }).name)).toEqual([
      "tokenProgram",
      "pot",
      "potUSDC",
      "toUSDC",
    ]);
    expect(program.entryParams).toEqual([
      { name: "to", type: "Address" },
      { name: "amount", type: "Uint256" },
    ]);
  });

  it("a Token-2022 mint moves by transferChecked, with the mint as an account and the registry's decimals", () => {
    const pyusd = svmTokenRows(SOLANA).find((row) => row.symbol === "PYUSD")!;
    const program = compile(
      "function main(to: Address, amount: Uint256) {\n  PYUSD.transfer(to, amount)\n}\n",
    );
    expect(program.source).toContain(
      `__sauce_transferChecked(PYUSD, token2022Program, potPYUSD, mintPYUSD, toPYUSD, pot, amount, ${pyusd.decimals});` +
        ' require(svm.sload(toPYUSD, 32, 32).toBe() == to, "wrong recipient account");',
    );
    expect(program.derivedAccounts).toEqual({
      token2022Program: TOKEN_2022_PROGRAM,
      pot: "self",
      mintPYUSD: "mint:PYUSD",
      potPYUSD: "self:PYUSD",
      toPYUSD: "@to:PYUSD",
    });
  });

  it("a tokenized stock, by its symbol in its own case, is a Token-2022 mint", () => {
    const program = compile("function main(to: Address) {\n  TSLAx.transfer(to, 1);\n}\n");
    expect(program.derivedAccounts).toMatchObject({
      mintTSLAx: "mint:TSLAx",
      toTSLAx: "@to:TSLAx",
    });
  });

  it("Token(mint) of an argument: either program, so transferChecked, the decimals read from the mint", () => {
    const program = compile(
      "function main(mint: Address, to: Address, amount: Uint256) {\n  Token(mint).transfer(to, amount);\n}\n",
    );
    expect(program.source).toContain(
      "__sauce_transferChecked(mint, mintProgram, potMint, mintAccount, toMint, pot, amount, svm.sload(mintAccount, 44, 1).toLe());",
    );
    expect(program.derivedAccounts).toEqual({
      mintProgram: "program:@mint",
      pot: "self",
      mintAccount: "mint:@mint",
      potMint: "self:@mint",
      toMint: "@to:@mint",
    });
  });

  it("Token(<32-byte key>) and a bound const t = Token(USDT): the registry's row where it records the mint", () => {
    const usdt = svmTokenRows(SOLANA).find((row) => row.symbol === "USDT")!;
    const literal = compile(
      `function main(to: Address) {\n  Token(${usdt.address}).transfer(to, 1);\n}\n`,
    );
    expect(literal.derivedAccounts).toMatchObject({
      tokenProgram: TOKEN_PROGRAM,
      toUSDT: "@to:USDT",
    });
    const bound = compile(
      "function main(to: Address, amount: Uint256) {\n  const t = Token(USDT);\n  t.transfer(to, amount);\n}\n",
    );
    expect(bound.source).toContain("const t = USDT;");
    expect(bound.source).toContain(
      "__sauce_transfer(t, tokenProgram, potUSDT, toUSDT, pot, amount);",
    );
  });

  it("a key written out is derived from itself, in base58", () => {
    const key = `0x${"ab".repeat(32)}`;
    const program = compile(`function main() {\n  USDC.transfer(${key}, 1);\n}\n`);
    const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0xab));
    expect(program.derivedAccounts).toMatchObject({ accountUSDC: `${base58}:USDC` });
    expect(program.source).toContain(`== ${key}, "wrong recipient account")`);
  });

  it("self.USDC and USDC.balanceOf(who) read through one checked helper, emitted once", () => {
    const program = compile(
      "function main(who: Address): Uint256 {\n  return self.USDC + USDC.balanceOf(who) + USDC.balanceOf(self);\n}\n",
    );
    expect(program.source).toContain(
      "return __sauce_svm_balance(USDC, potUSDC, pot.address) + __sauce_svm_balance(USDC, whoUSDC, who) + __sauce_svm_balance(USDC, potUSDC, pot.address);",
    );
    expect(program.source.match(/function __sauce_svm_balance/g)).toHaveLength(1);
    expect(program.derivedAccounts).toEqual({
      potUSDC: "self:USDC",
      pot: "self",
      whoUSDC: "@who:USDC",
    });
  });

  it("ctx.self() as a holder is the Pot, as on the EVM: one program for Base and Solana", () => {
    const source =
      "function main(to: Address, amount: Uint256) {\n" +
      '  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");\n' +
      "  USDC.transfer(to, amount);\n" +
      "}\n";
    const solana = compile(source);
    expect(solana.source).toContain("__sauce_svm_balance(USDC, potUSDC, pot.address) >= amount");
    expect(solana.derivedAccounts).toMatchObject({ potUSDC: "self:USDC", pot: "self" });
    expect(compileSauceProgram("base", source).bytecode.length).toBeGreaterThan(0);
  });

  it("approve checks the delegate account is the spender; transferFrom checks the sender's account too", () => {
    const approve = compile(
      "function main(spender: Address, amount: Uint256) {\n  USDC.approve(spender, amount);\n}\n",
    );
    expect(approve.source).toContain(
      "__sauce_approve(USDC, tokenProgram, potUSDC, spenderAccount, pot, amount);" +
        ' require(spenderAccount == spender, "wrong spender account");',
    );
    expect(approve.derivedAccounts).toMatchObject({ spenderAccount: "@spender" });
    const from = compile(
      "function main(from: Address, to: Address, amount: Uint256) {\n  USDC.transferFrom(from, to, amount);\n}\n",
    );
    expect(from.source).toContain(
      "__sauce_transferFrom(USDC, tokenProgram, fromUSDC, toUSDC, pot, amount);" +
        ' require(svm.sload(fromUSDC, 32, 32).toBe() == from, "wrong sender account");' +
        ' require(svm.sload(toUSDC, 32, 32).toBe() == to, "wrong recipient account");',
    );
  });

  it("a write that is a branch's body is braced with its check; one with no semicolon gets one", () => {
    const program = compile(
      "function main(to: Address, amount: Uint256) {\n  if (amount > 0) USDC.transfer(to, amount)\n  else USDT.transfer(to, 1);\n}\n",
    );
    expect(program.source).toContain(
      "if (amount > 0) { __sauce_transfer(USDC, tokenProgram, potUSDC, toUSDC, pot, amount);" +
        ' require(svm.sload(toUSDC, 32, 32).toBe() == to, "wrong recipient account"); }\n' +
        "  else { __sauce_transfer(USDT, tokenProgram, potUSDT, toUSDT, pot, 1);",
    );
  });

  it("a read inside a write's amount is lowered on its own", () => {
    const program = compile("function main(to: Address) {\n  USDC.transfer(to, self.USDC);\n}\n");
    expect(program.source).toContain(
      "__sauce_transfer(USDC, tokenProgram, potUSDC, toUSDC, pot, __sauce_svm_balance(USDC, potUSDC, pot.address));",
    );
  });

  it("an Account parameter in a holder's place is the token account itself: attached by the caller, unchecked", () => {
    const program = compile(
      "function main(dest: Account<Writable>, amount: Uint256) {\n  USDC.transfer(dest, amount);\n}\n",
    );
    expect(program.source).toContain(
      "__sauce_transfer(USDC, tokenProgram, potUSDC, dest, pot, amount);\n",
    );
    expect(program.derivedAccounts).not.toHaveProperty("dest");
    expect(() =>
      compile(
        "function main(dest: Account, amount: Uint256) {\n  USDC.transfer(dest, amount);\n}\n",
      ),
    ).toThrow("`dest` is a token account the call writes, so declare it `dest: Account<Writable>`");
  });

  it("an added account never takes a name the program declares", () => {
    const program = compile(
      "function main(pot: Account, to: Address) {\n  USDC.transfer(to, 1);\n}\n",
    );
    expect(program.derivedAccounts).toMatchObject({ pot2: "self" });
    expect(program.manifest!.accounts.map((slot) => (slot as { name: string }).name)).toContain(
      "pot",
    );
  });

  it("a symbol a define gives its own mint (a devnet one) is derived from that mint, by the checked write", () => {
    const key = BigInt(`0x${"cd".repeat(32)}`);
    const program = compile("function main(to: Address) {\n  USDC.transfer(to, 1);\n}\n", {
      USDC: key,
    });
    const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0xcd));
    expect(program.derivedAccounts).toMatchObject({
      potUSDC: `self:${base58}`,
      programUSDC: `program:${base58}`,
    });
    expect(program.source).toContain("__sauce_transferChecked(USDC,");
  });

  it("leaves the explicit forms, and a program that names no token method, exactly as written", () => {
    const explicit =
      "function main(tokenProgram: Account, source: Account<Writable>, destination: Account<Writable>, authority: Account<Signer>, mint: Address, amount: Uint256): Uint256 {\n" +
      "  const before = balanceOf(mint, destination);\n" +
      "  transfer(USDC, tokenProgram, source, destination, authority, amount);\n" +
      "  return balanceOf(mint, destination) - before;\n" +
      "}\n";
    expect(lower(explicit)).toEqual({ source: explicit, rewrote: false, derived: {} });
    expect(compile(explicit).derivedAccounts).toBeUndefined();
    // A program that declares the symbol owns it.
    const owned = "function main(USDC: Account) {\n  USDC.transfer(1, 2);\n}\n";
    expect(lower(owned).rewrote).toBe(false);
  });

  describe("refusals, each naming what to write instead", () => {
    it("a holder computed as the program runs", () => {
      expect(() =>
        compile(
          "function main(amount: Uint256) {\n  const r = 5;\n  USDC.transfer(r, amount);\n}\n",
        ),
      ).toThrow(
        "`USDC.transfer(…)` on Solana: the recipient must be known when the transaction is built, " +
          "to attach its token account — `self`, a parameter of main declared `Address`, or a " +
          "32-byte key — and `r` is not. For an account known only as the program runs, take the " +
          "token account as a parameter of main (`dest: Account<Writable>`) and pass that.",
      );
    });

    it("a holder computed as the program runs, in a read: its token account as an Account", () => {
      expect(() =>
        compile("function main(): Uint256 {\n  const who = 7;\n  return USDC.balanceOf(who);\n}\n"),
      ).toThrow(
        "take the token account as a parameter of main (`account: Account`) and pass that.",
      );
    });

    it("a call in a helper, or in a program with no main", () => {
      expect(() =>
        compile(
          "function pay(to: Address) {\n  USDC.transfer(to, 1);\n}\nfunction main(to: Address) {\n  pay(to);\n}\n",
        ),
      ).toThrow("`USDC.transfer(…)` on Solana stands in `pay`");
      expect(() => compile(`USDC.transfer(0x${"ab".repeat(32)}, 1);\n`)).toThrow(
        "and this program has no main",
      );
    });

    it("a write whose result is read, and a wrong count of arguments", () => {
      expect(() =>
        compile("function main(to: Address) {\n  const ok = USDC.transfer(to, 1);\n}\n"),
      ).toThrow("`USDC.transfer(…)` returns nothing, so its result cannot be used");
      expect(() => compile("function main(to: Address) {\n  USDC.transfer(to);\n}\n")).toThrow(
        "`USDC.transfer(…)` takes 2 arguments (to, amount), got 1.",
      );
    });

    it("Token(x) of a value the transaction does not name, and a Token(x) used as a value", () => {
      expect(() =>
        compile("function main(to: Address) {\n  const m = 1;\n  Token(m).transfer(to, 1);\n}\n"),
      ).toThrow("Token(m) on Solana: the mint must be known when the transaction is built");
      expect(() =>
        compile("function main(to: Address) {\n  const x = [Token(USDC)];\n}\n"),
      ).toThrow("is used as a value, not called or bound");
    });

    it("a name the lowering reserves", () => {
      expect(() =>
        compile(
          "function __sauce_svm_balance() {}\nfunction main(to: Address) {\n  USDC.transfer(to, 1);\n}\n",
        ),
      ).toThrow("`__sauce_svm_balance` is reserved");
    });
  });
});
