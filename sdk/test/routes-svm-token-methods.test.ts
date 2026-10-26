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
      pot: "authority",
      potUSDC: "authority:USDC",
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

  it("a write through parentheses, around its method or an argument, keeps them matched", () => {
    const write = (call: string) =>
      compile(`function main(to: Address, amount: Uint256) {\n  ${call};\n}\n`);
    const plain = write("USDC.transfer(to, amount)");
    for (const call of [
      "(USDC.transfer)(to, amount)",
      "((USDC.transfer))(to, amount)",
      "USDC.transfer(to, (amount))",
      "USDC.transfer((to), ((amount)))",
      "(USDC.transfer)(to, (amount),)",
    ]) {
      const program = write(call);
      expect(program.bytecode).toEqual(plain.bytecode);
      expect(program.manifest).toEqual(plain.manifest);
    }
    // A write that is a branch's body, its checks after it in braces.
    const branch = (call: string) =>
      compile(`function main(to: Address, amount: Uint256) {\n  if (amount > 0) ${call};\n}\n`);
    expect(branch("(USDC.transfer)(to, (amount))").bytecode).toEqual(
      branch("USDC.transfer(to, amount)").bytecode,
    );
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
      pot: "authority",
      mintPYUSD: "mint:PYUSD",
      potPYUSD: "authority:PYUSD",
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
      pot: "authority",
      mintAccount: "mint:@mint",
      potMint: "authority:@mint",
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

  it("pot.USDC and USDC.balanceOf(who) read through one checked helper, emitted once", () => {
    const program = compile(
      "function main(who: Address): Uint256 {\n  return pot.USDC + USDC.balanceOf(who) + USDC.balanceOf(pot);\n}\n",
    );
    expect(program.source).toContain(
      "return __sauce_svm_balance(USDC, potUSDC, pot.address) + __sauce_svm_balance(USDC, whoUSDC, who) + __sauce_svm_balance(USDC, potUSDC, pot.address);",
    );
    expect(program.source.match(/function __sauce_svm_balance/g)).toHaveLength(1);
    expect(program.derivedAccounts).toEqual({
      potUSDC: "pot:USDC",
      pot: "pot",
      whoUSDC: "@who:USDC",
    });
  });

  it("ctx.self() as a holder is the account the program acts with, as on the EVM: one program for Base and Solana", () => {
    const source =
      "function main(to: Address, amount: Uint256) {\n" +
      '  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");\n' +
      "  USDC.transfer(to, amount);\n" +
      "}\n";
    const solana = compile(source);
    expect(solana.source).toContain("__sauce_svm_balance(USDC, potUSDC, pot.address) >= amount");
    // It names no `pot`, so it runs --via engine from the owner's accounts too.
    expect(solana.derivedAccounts).toMatchObject({
      potUSDC: "authority:USDC",
      pot: "authority",
    });
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
    const program = compile("function main(to: Address) {\n  USDC.transfer(to, pot.USDC);\n}\n");
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
    expect(program.derivedAccounts).toMatchObject({ pot2: "authority" });
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
      potUSDC: `authority:${base58}`,
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

  describe("Token-2022 and the edges of each method", () => {
    const pyusd = svmTokenRows(SOLANA).find((row) => row.symbol === "PYUSD")!;

    it("PYUSD.transferFrom and PYUSD.approve take the checked writes with the registry's decimals", () => {
      const from = compile(
        "function main(from: Address, to: Address, amount: Uint256) {\n  PYUSD.transferFrom(from, to, amount);\n}\n",
      );
      expect(from.source).toContain(
        `__sauce_transferChecked(PYUSD, token2022Program, fromPYUSD, mintPYUSD, toPYUSD, pot, amount, ${pyusd.decimals});` +
          ' require(svm.sload(fromPYUSD, 32, 32).toBe() == from, "wrong sender account");' +
          ' require(svm.sload(toPYUSD, 32, 32).toBe() == to, "wrong recipient account");',
      );
      const approve = compile(
        "function main(spender: Address, amount: Uint256) {\n  PYUSD.approve(spender, amount);\n}\n",
      );
      expect(approve.source).toContain(
        `__sauce_approveChecked(PYUSD, token2022Program, potPYUSD, mintPYUSD, spenderAccount, pot, amount, ${pyusd.decimals});` +
          ' require(spenderAccount == spender, "wrong spender account");',
      );
    });

    it("pot.PYUSD reads the Pot's Token-2022 account, with no mint account: a read needs none", () => {
      const program = compile("function main(): Uint256 {\n  return pot.PYUSD;\n}\n");
      expect(program.source).toContain("return __sauce_svm_balance(PYUSD, potPYUSD, pot.address);");
      expect(program.derivedAccounts).toEqual({ potPYUSD: "pot:PYUSD", pot: "pot" });
    });

    it("approve(pot, …) makes the Pot its own delegate: the authority's slot, nothing to check", () => {
      const program = compile(
        "function main(amount: Uint256) {\n  USDC.approve(pot, amount);\n}\n",
      );
      expect(program.source).toContain(
        "__sauce_approve(USDC, tokenProgram, potUSDC, pot, pot, amount);\n",
      );
      expect(program.derivedAccounts).toMatchObject({ pot: "pot", potUSDC: "pot:USDC" });
    });

    it("Token(<key>) of a mint no row records: the checked write, its program and decimals read", () => {
      const key = `0x${"5a".repeat(32)}`;
      const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0x5a));
      const program = compile(
        `function main(to: Address) {\n  Token(${key}).transfer(to, 1);\n}\n`,
      );
      expect(program.source).toContain(
        `__sauce_transferChecked(${key}, programToken1, potToken1, mintToken1, toToken1, pot, 1, svm.sload(mintToken1, 44, 1).toLe());`,
      );
      expect(program.derivedAccounts).toEqual({
        programToken1: `program:${base58}`,
        pot: "authority",
        mintToken1: `mint:${base58}`,
        potToken1: `authority:${base58}`,
        toToken1: `@to:${base58}`,
      });
    });

    it("every added account takes a name of its own, however many the program has taken", () => {
      const program = compile(
        "function main(pot: Account, tokenProgram: Account, potUSDC: Account, pot2: Account, to: Address) {\n" +
          "  USDC.transfer(to, 1);\n}\n",
      );
      expect(program.derivedAccounts).toEqual({
        tokenProgram2: TOKEN_PROGRAM,
        pot3: "authority",
        potUSDC2: "authority:USDC",
        toUSDC: "@to:USDC",
      });
    });

    it("an explicit Account holder is paid as attached: no holder is named, so nothing is checked", () => {
      const program = compile(
        "function main(dest: Account<Writable>, amount: Uint256) {\n  PYUSD.transfer(dest, amount);\n}\n",
      );
      expect(program.source).toContain(
        `__sauce_transferChecked(PYUSD, token2022Program, potPYUSD, mintPYUSD, dest, pot, amount, ${pyusd.decimals});\n`,
      );
      expect(program.source).not.toContain("wrong recipient account");
    });
  });

  describe("refusals, each naming what to write instead", () => {
    it("a holder computed as the program runs", () => {
      expect(() =>
        compile(
          "function main(amount: Uint256) {\n  const r = 5;\n  USDC.transfer(r, amount);\n}\n",
        ),
      ).toThrow(
        "`USDC.transfer(…)` on Solana: the recipient must be known when the transaction is built, " +
          "to attach its token account — `pot`, a parameter of main declared `Address`, a " +
          "token's mint, or a 32-byte key — and `r` is not. For an account known only as the program runs, take the " +
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

    it("a call in a function inside another, and a recipient that is a helper's own parameter", () => {
      expect(() =>
        compile(
          "function main(to: Address): Uint256 {\n  const p = program((): Uint256 => USDC.balanceOf(pot));\n  return 1;\n}\n",
        ),
      ).toThrow("`USDC.balanceOf(…)` on Solana stands in a function inside another");
      expect(() =>
        compile(
          "function pay(to: Address) {\n  USDC.transfer(to, 1);\n}\nfunction main(to: Address) {\n  pay(to);\n}\n",
        ),
      ).toThrow(
        "`USDC.transfer(…)` on Solana: the recipient must be known when the transaction is built, " +
          "to attach its token account — `pot`, a parameter of main declared `Address`, a token's " +
          "mint, or a 32-byte key — and `to` is not: it is a parameter of `pay`, a value only the " +
          "program has as it runs. Make the call in main, where `to` can be main's `Address`, or " +
          "take the token account as a parameter of main (`dest: Account<Writable>`) and pass it " +
          "to `pay` as an `Account`.",
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

describe("the balance shorthand on Solana: namespace holders and lamports", () => {
  const hex = (source: string) => Buffer.from(compile(source).bytecode).toString("hex");

  it("pot.balance is the Pot's lamports: ctx.balance of the Pot the cook attaches", () => {
    const program = compile("function main(): Uint256 {\n  return pot.balance;\n}\n");
    expect(program.source).toBe(
      "function main(pot: Account<Signer>): Uint256 {\n  return ctx.balance(pot.address);\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ pot: "pot" });
    expect(hex("function main(): Uint256 {\n  return pot.balance;\n}\n")).toBe(
      hex(
        "function main(pot: Account<Signer>): Uint256 {\n  return ctx.balance(pot.address);\n}\n",
      ),
    );
    // `ctx.self()` is the account the program acts with too: one slot with the Pot it names.
    expect(hex("function main(): Uint256 {\n  return ctx.self().balance + pot.balance;\n}\n")).toBe(
      hex(
        "function main(pot: Account<Signer>): Uint256 {\n  return ctx.balance(pot.address) + ctx.balance(pot.address);\n}\n",
      ),
    );
  });

  it("to.balance reads main's argument's lamports, its account attached as the cook is built", () => {
    const program = compile("function main(to: Address): Uint256 {\n  return to.balance;\n}\n");
    expect(program.source).toBe(
      "function main(to: Address, toAccount: Account): Uint256 {\n  return ctx.balance(to);\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ toAccount: "@to" });
  });

  it("an account's .balance is its lamports by its key: an Account, an account expression, a local bound to one", () => {
    const program = compile(
      "function main(a: Account, to: Address): Uint256 {\n" +
        "  const vault = USDC.accountOf(to).writable();\n" +
        "  return a.balance + vault.balance + Account.pda(Account.systemProgram, [to]).balance + Account.systemProgram.balance;\n" +
        "}\n",
    );
    expect(program.source).toContain(
      "  const vault = toUSDC;\n" +
        "  return ctx.balance(a.address) + ctx.balance(vault.address) + ctx.balance(pda1.address) + ctx.balance(systemProgram.address);",
    );
    expect(program.derivedAccounts).toMatchObject({
      toUSDC: "@to:USDC",
      pda1: "pda:11111111111111111111111111111111:@to",
      systemProgram: "11111111111111111111111111111111",
    });
  });

  it("pot.owner and pot hold tokens, each account checked to its holder", () => {
    const program = compile(
      "function main(): Uint256 {\n  return pot.owner.USDC + pot.USDC + pot.owner.balance;\n}\n",
    );
    expect(program.source).toContain(
      "return __sauce_svm_balance(USDC, ownerUSDC, owner.address) + __sauce_svm_balance(USDC, potUSDC, pot.address) + ctx.balance(owner.address);",
    );
    expect(program.derivedAccounts).toEqual({
      owner: "owner",
      ownerUSDC: "owner:USDC",
      potUSDC: "pot:USDC",
      pot: "pot",
    });
    expect(hex("function main(): Uint256 {\n  return pot.USDC;\n}\n")).toBe(
      hex("function main(): Uint256 {\n  return USDC.balanceOf(pot);\n}\n"),
    );
  });

  it("a mint is a holder: its lamports, and its own associated token account off the mint key", () => {
    const program = compile("function main(): Uint256 {\n  return USDC.balance + USDC.WSOL;\n}\n");
    expect(program.source).toContain(
      "function main(mintUSDC: Account, USDCWSOL: Account): Uint256 {\n  return ctx.balance(USDC) + __sauce_svm_balance(WSOL, USDCWSOL, USDC);",
    );
    expect(program.derivedAccounts).toEqual({
      mintUSDC: "mint:USDC",
      USDCWSOL: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:WSOL",
    });
    expect(hex("function main(): Uint256 {\n  return USDC.balance;\n}\n")).toBe(
      hex("function main(mintUSDC: Account): Uint256 {\n  return ctx.balance(USDC);\n}\n"),
    );
    expect(hex("function main(): Uint256 {\n  return USDC.WSOL;\n}\n")).toBe(
      hex("function main(): Uint256 {\n  return WSOL.balanceOf(USDC);\n}\n"),
    );
  });

  it("a record's or a list's balance, and its SOL, is its own field", () => {
    const record =
      "interface Leg {\n  balance: Uint256;\n  SOL: Uint256;\n}\n" +
      "function main(leg: Leg, legs: Leg[]): Uint256 {\n" +
      "  const r = { balance: 7, SOL: 1 };\n" +
      "  return leg.balance + legs[0].balance + r.balance + leg.SOL + r.SOL;\n}\n";
    const program = compile(record);
    expect(program.source).toBe(record);
    expect(program.derivedAccounts).toBeUndefined();
  });

  it("says what is wrong with a balance it cannot read", () => {
    const refusal = (source: string) => {
      try {
        compile(source);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`compiled: ${source}`);
    };
    expect(refusal("function main(): Uint256 {\n  return pot.USDCC;\n}\n")).toBe(
      "`pot.USDCC` on Solana: `USDCC` is not a token solana registers. Did you mean `USDC`? " +
        "`pot.<TOKEN>` reads the Pot's balance of a token and `pot.balance` its lamports; " +
        "`pot.address`, `pot.dataLen`, `pot.signer()` and `pot.writable()` are its account's, " +
        "and `pot.owner` its owner's.",
    );
    // The Pot's members are said too: its owner is `pot.owner`.
    expect(refusal("function main(): Address {\n  return pot.ownr;\n}\n")).toMatch(
      /^`pot\.ownr` on Solana: `ownr` is not a token solana registers\. Did you mean `owner`\?/,
    );
    // A token the program declares a name of its own for is said to be hidden, not misspelled.
    expect(refusal("function main(): Uint256 {\n  const USDC = 5;\n  return pot.USDC;\n}\n")).toBe(
      "`pot.USDC` on Solana: `USDC` is a token solana registers, and the program declares its " +
        "own `USDC` where this reads it, which hides the token. `pot.<TOKEN>` reads a token by " +
        "the symbol the chain gives it: rename the program's `USDC`.",
    );
    expect(refusal("function main(): Uint256 {\n  return pot.balanse;\n}\n")).toMatch(
      /^`pot\.balanse` on Solana: `balanse` is not a token solana registers\. Did you mean `balance`\?/,
    );
    expect(
      refusal("function main(to: Address): Uint256 {\n  const x = to;\n  return x.USDC;\n}\n"),
    ).toMatch(/^`x\.USDC` on Solana: the holder must be known when the transaction is built/);
    expect(refusal("function main(p: { to: Address }): Uint256 {\n  return p.USDC;\n}\n")).toMatch(
      /^`p\.USDC`: `p` is a record, not an address, and `USDC` names a token/,
    );
  });

  it("refuses .SOL on a holder: SOL is no token on Solana, and the lamports are .balance", () => {
    for (const [holder, params] of [
      ["pot", ""],
      ["to", "to: Address"],
      ["a", "a: Account"],
      ["USDC", ""],
      ["pot.owner", ""],
      ["ctx.self()", ""],
      ["USDC.accountOf(to)", "to: Address"],
    ] as const) {
      expect(() =>
        compile(`function main(${params}): Uint256 {\n  return ${holder}.SOL;\n}\n`),
      ).toThrow(
        `\`${holder}.SOL\`: a holder's native coin is \`.balance\`: write \`${holder}.balance\`. ` +
          "`.SOL` is not a token on solana, and `.<SYMBOL>` reads only a token the chain registers.",
      );
    }
  });
});
