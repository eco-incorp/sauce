/**
 * The Pot on Solana (`svm-account-expressions.ts`, `svm-token-rewrite.ts`, `svm-lowering.ts`):
 * bare `pot` is the Pot's key where a value is wanted and its account where one is, its balances
 * are `pot.<TOKEN>` and `pot.balance`, the retired `self` and `Solana.self` are refused naming what
 * to write, and a site stands in `main`, in a top-level function (given the accounts it uses as
 * parameters, passed at each call), or in a script (given the `main` it runs as). A program that
 * names the Pot derives `pot`; one that does not derives `authority`, the account that signs the
 * engine call. Compiled through `compileSauceProgram` and the real compiler; executed in
 * `cli-solana-token-methods.e2e.test.ts`.
 */
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { rewriteSvmTokenSyntax } from "../src/routes/svm-token-rewrite.js";
import { resolveTokenMap, svmTokenRows } from "../src/routes/token-registry.js";
import { requireChain } from "../src/chains/canonical.js";

const SOLANA = requireChain("solana");

const compile = (source: string) => compileSauceProgram("solana", source);
const hex = (source: string) => Buffer.from(compile(source).bytecode).toString("hex");
const roles = (program: CompiledSauceProgram) =>
  Object.fromEntries(
    program.manifest!.accounts.map((slot) => {
      const s = slot as { name: string; requires: string };
      return [s.name, s.requires];
    }),
  );
const refusal = (source: string): string => {
  try {
    compile(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`compiled: ${source}`);
};

describe("pot on Solana: the Pot's key, and its account", () => {
  it("bare pot is the Pot's key, the address pot.balance reads", () => {
    const program = compile("function main(): Address {\n  return pot;\n}\n");
    expect(program.source).toBe(
      "function main(pot: Account<Signer>): Address {\n  return pot.address;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ pot: "pot" });
    expect(hex("function main(a: Address): bool {\n  return a == pot && pot != 0;\n}\n")).toBe(
      hex(
        "function main(a: Address, pot: Account<Signer>): bool {\n  return a == pot.address && pot.address != 0;\n}\n",
      ),
    );
    // A method on it is its key's; a shorthand record field keeps its name.
    expect(compile("function main(): bytes {\n  return pot.toBytesBe(32);\n}\n").source).toContain(
      "return pot.address.toBytesBe(32);",
    );
    expect(
      compile("function main(): Uint256 {\n  const r = { pot };\n  return r.pot;\n}\n").source,
    ).toContain("const r = { pot: pot.address };");
  });

  it("is the Pot's account where one is wanted: a role, a field, svm's accounts, an Account parameter", () => {
    const program = compile(
      "function size(a: Account): Uint256 {\n  return a.dataLen;\n}\n" +
        "function main(data: bytes): Uint256 {\n" +
        "  svm.call(Account.systemProgram, [pot.signer(), pot.writable(), pot], data);\n" +
        "  return pot.dataLen + svm.sload(pot, 0, 8).toLe() + size(pot);\n" +
        "}\n",
    );
    expect(program.source).toContain(
      "  svm.call(systemProgram, [pot, pot, pot], data);\n" +
        "  return pot.dataLen + svm.sload(pot, 0, 8).toLe() + size(pot);",
    );
    expect(program.derivedAccounts).toEqual({
      systemProgram: "11111111111111111111111111111111",
      pot: "pot",
    });
    expect(roles(program)).toEqual({ systemProgram: "readonly", pot: "writable_signer" });
  });

  it("is the slot Solana.self was, Account<Signer>, wherever it is named; its pot.owner is the owner's", () => {
    // A cook signs for it; only the Kitchen signs for the Pot (direct-engine.e2e measures the hold).
    for (const body of ["return pot;", "return svm.sload(pot, 0, 8).toLe();"]) {
      const program = compile(`function main(): Uint256 {\n  ${body}\n}\n`);
      expect(roles(program).pot).toBe("readonly_signer");
    }
    // `pot.owner` is the Pot's owner, the account `Solana.owner` was, and names no Pot.
    const owner = compile(
      'function main(caller: Address) {\n  require(caller == pot.owner.address, "owner");\n}\n',
    );
    expect(owner.source).toBe(
      'function main(caller: Address, owner: Account) {\n  require(caller == owner.address, "owner");\n}\n',
    );
    expect(owner.derivedAccounts).toEqual({ owner: "owner" });
  });

  it("is an account for a function @sauce/token declares one for", () => {
    const program = compile(
      'import { ownerOf } from "@sauce/token";\n' +
        "function main(): Address {\n  return ownerOf(WSOL, WSOL.accountOf(pot)) + ownerOf(WSOL, pot);\n}\n",
    );
    expect(program.source).toContain("return ownerOf(WSOL, potWSOL) + ownerOf(WSOL, pot);");
  });

  it("reads .signer(), .writable(), .address and the rest as the account's, never as a token's", () => {
    const key = BigInt(`0x${"ab".repeat(32)}`);
    const tokens = new Map([
      ...resolveTokenMap(SOLANA),
      ["signer", key],
      ["writable", key],
      ["address", key],
    ]);
    const lowered = rewriteSvmTokenSyntax(
      "function main(data: bytes): Uint256 {\n  svm.call(pot.signer(), [pot.writable()], data);\n  return pot.address;\n}\n",
      tokens,
      svmTokenRows(SOLANA),
      "mainnet-beta",
    );
    expect(lowered.source).toBe(
      "function main(data: bytes, pot: Account<Writable, Signer>): Uint256 {\n  svm.call(pot, [pot], data);\n  return pot.address;\n}\n",
    );
  });

  it("is one account with the authority a token write signs with, derived as the Pot", () => {
    const program = compile(
      "function main(to: Address): Uint256 {\n  USDC.transfer(to, 1);\n  return pot.balance + USDC.balanceOf(ctx.self());\n}\n",
    );
    expect(program.derivedAccounts).toEqual({
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      pot: "pot",
      potUSDC: "pot:USDC",
      toUSDC: "@to:USDC",
    });
  });

  it("a program that never names pot derives authority: the account that signs the engine call", () => {
    const program = compile(
      "function main(to: Address): Uint256 {\n  USDC.transfer(to, 1);\n  return ctx.self().balance;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      pot: "authority",
      potUSDC: "authority:USDC",
      toUSDC: "@to:USDC",
    });
  });

  it("a program that declares pot or self owns the name", () => {
    const pot = compile(
      "function main(pot: Address, to: Address): Uint256 {\n  USDC.transfer(to, 1);\n  return pot.USDC + pot.balance;\n}\n",
    );
    // Its `pot` is main's argument; the Pot's own slot is named apart, and derived as the
    // authority, since the program names no Pot.
    expect(pot.derivedAccounts).toEqual({
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      pot2: "authority",
      potUSDC: "authority:USDC",
      toUSDC: "@to:USDC",
      potUSDC2: "@pot:USDC",
      potAccount: "@pot",
    });
    expect(pot.source).toContain(
      "return __sauce_svm_balance(USDC, potUSDC2, pot) + ctx.balance(pot);",
    );
    const self = "function main(self: Address): Uint256 {\n  return self;\n}\n";
    expect(compile(self).source).toBe(self);
    expect(
      compile("function main(self: Address): Uint256 {\n  return self.USDC;\n}\n").derivedAccounts,
    ).toEqual({
      selfUSDC: "@self:USDC",
    });
  });

  it("a pot, self, token symbol or Solana the program declares is its own in that scope only", () => {
    const elsewhere = (name: string) =>
      `function size(): Uint256 {\n  const ${name} = 5;\n  return ${name};\n}\n`;
    // The Pot outside the function or block that declares a `pot`, its slot named apart from it.
    expect(
      compile(`${elsewhere("pot")}function main(): Address {\n  return pot;\n}\n`).source,
    ).toBe(
      `${elsewhere("pot")}function main(pot2: Account<Signer>): Address {\n  return pot2.address;\n}\n`,
    );
    expect(
      compile(
        'function main(flag: bool): Address {\n  if (flag) {\n    const pot = 5;\n    require(pot > 0, "low");\n  }\n  return pot;\n}\n',
      ).source,
    ).toBe(
      'function main(flag: bool, pot2: Account<Signer>): Address {\n  if (flag) {\n    const pot = 5;\n    require(pot > 0, "low");\n  }\n  return pot2.address;\n}\n',
    );
    expect(refusal(`${elsewhere("self")}function main(): Address {\n  return self;\n}\n`)).toMatch(
      /^`self`: the Pot is `pot`, not `self`/,
    );
    expect(
      compile(`${elsewhere("USDC")}function main(): Uint256 {\n  return pot.USDC;\n}\n`).source,
    ).toContain("return __sauce_svm_balance(USDC, potUSDC, pot.address);");
    // The Pot's owner outside the function that declares an `owner`, its slot named apart from it.
    expect(
      compile(`${elsewhere("owner")}function main(): Uint256 {\n  return pot.owner.balance;\n}\n`)
        .source,
    ).toContain("return ctx.balance(owner2.address);");
    // Another scope's record named `pot` does not make the Pot one.
    const record =
      "function size(): Uint256 {\n  const pot = { balance: 7 };\n  return pot.balance;\n}\n";
    const shaped = compile(
      `${record}function main(): Uint256 {\n  return pot.USDC + pot.balance;\n}\n`,
    );
    expect(shaped.source).toContain(
      `${record}function main(potUSDC: Account, pot2: Account<Signer>): Uint256 {\n` +
        "  return __sauce_svm_balance(USDC, potUSDC, pot2.address) + ctx.balance(pot2.address);\n}\n",
    );
    // A symbol main binds as a parameter is no token anywhere: its accounts' checks stand in main.
    expect(
      refusal(
        "function held(): Uint256 {\n  return pot.USDC;\n}\nfunction main(USDC: Uint256): Uint256 {\n  return held() + USDC;\n}\n",
      ),
    ).toMatch(
      /^`pot\.USDC` on Solana: `USDC` is a token solana registers, and the program declares its own `USDC`/,
    );
  });

  it("a name a pattern or a catch clause binds is no read of pot or self", () => {
    const lower = (source: string) =>
      rewriteSvmTokenSyntax(source, resolveTokenMap(SOLANA), svmTokenRows(SOLANA), "mainnet-beta");
    for (const name of ["pot", "self"]) {
      for (const body of [
        `const [${name}, bump] = crypto.findPDA(program, [hex\`01\`]);\n  return bump;`,
        `const { ${name} } = rec;\n  return 1;`,
        `const { key: ${name} } = rec;\n  return 1;`,
        `const [first, ...${name}] = rec;\n  return 1;`,
        `try {\n    return 1;\n  } catch (${name}) {\n    return 2;\n  }`,
      ]) {
        const source = `function main(program: Address): Uint256 {\n  ${body}\n}\n`;
        expect(lower(source)).toMatchObject({ rewrote: false, source });
      }
    }
    // A default is a read: `pot` there is the Pot's key.
    expect(
      lower("function main(rec: Uint256): Uint256 {\n  const [a = pot] = rec;\n  return a;\n}\n")
        .source,
    ).toContain("const [a = pot.address] = rec;");
  });

  it("a pot or self the caller binds (a define, an ambient module's export) is the caller's", () => {
    const lower = (source: string) =>
      rewriteSvmTokenSyntax(
        source,
        resolveTokenMap(SOLANA),
        svmTokenRows(SOLANA),
        "mainnet-beta",
        undefined,
        undefined,
        undefined,
        new Set(["pot", "self"]),
      );
    for (const name of ["pot", "self"]) {
      const source = `function main(): Address {\n  return ${name};\n}\n`;
      expect(lower(source).source).toBe(source);
    }
    // The Pot's own slot, which a token write signs with, is named apart from the caller's `pot`.
    const write = lower("function main(to: Address) {\n  USDC.transfer(to, 1);\n}\n");
    expect(write.derived).toMatchObject({ pot2: "authority", potUSDC: "authority:USDC" });
  });

  it("a local bound to bare pot holds what its declared type says: the Pot's key, else its account", () => {
    // An `Address` alias, annotated or not, is the Pot's key: its `.balance` the lamports there.
    for (const declared of [": Address", ""]) {
      const program = compile(
        `function main(): Uint256 {\n  const holder${declared} = pot;\n  return holder.balance;\n}\n`,
      );
      expect(program.source).toBe(
        `function main(pot: Account<Signer>): Uint256 {\n  const holder${declared} = pot.address;\n  return ctx.balance(holder);\n}\n`,
      );
      expect(program.derivedAccounts).toEqual({ pot: "pot" });
    }
    // One declared `Account` is the Pot's account, its `.balance` read by its key.
    expect(
      compile(
        "function main(): Uint256 {\n  const holder: Account = pot;\n  return holder.balance;\n}\n",
      ).source,
    ).toBe(
      "function main(pot: Account<Signer>): Uint256 {\n  const holder: Account = pot;\n  return ctx.balance(holder.address);\n}\n",
    );
    // A token balance needs a holder known when the transaction is built, which a local is not.
    expect(
      refusal(
        "function main(): Uint256 {\n  const holder: Address = pot;\n  return holder.USDC;\n}\n",
      ),
    ).toMatch(
      /^`holder\.USDC` on Solana: the holder must be known when the transaction is built, to attach its token account — `pot`, /,
    );
  });

  it("an account's .balance through parentheses keeps them matched", () => {
    for (const receiver of ["(vault)", "((vault))"]) {
      expect(
        compile(`function main(vault: Account): Uint256 {\n  return ${receiver}.balance;\n}\n`)
          .source,
      ).toBe("function main(vault: Account): Uint256 {\n  return ctx.balance(vault.address);\n}\n");
    }
    // The account expression inside is lowered on its own.
    const pda = compile(
      'function main(): Uint256 {\n  return (Account.pda(Account.systemProgram, ["a"])).balance;\n}\n',
    );
    expect(pda.source).toContain("return ctx.balance(aPda.address);");
  });
});

describe("the retired spellings, refused naming what to write", () => {
  it.each([
    ["return self;", "self", "pot"],
    ["return self.USDC;", "self.USDC", "pot.USDC"],
    ["return self.SOL;", "self.SOL", "pot.balance"],
    ["return USDC.balanceOf(self);", "self", "pot"],
    ["return Solana.self.dataLen;", "Solana.self.dataLen", "pot.dataLen"],
    ["return Solana.self.USDC;", "Solana.self.USDC", "pot.USDC"],
    ["return Solana.self.address;", "Solana.self.address", "pot.address"],
    [
      "svm.call(Account.systemProgram, [Solana.self.signer()], hex``); return 0;",
      "Solana.self.signer()",
      "pot.signer()",
    ],
    ['return Account.pda(Account.systemProgram, ["a", self]).dataLen;', "self", "pot"],
  ])("%s", (body, site, instead) => {
    expect(refusal(`function main(): Uint256 {\n  ${body}\n}\n`)).toBe(
      `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
        "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).",
    );
  });

  // `Solana.self` was the Pot's account: what each refusal names compiles, in the same place.
  const value = (type: string) => `function main(): ${type} {\n  return X;\n}\n`;
  const account =
    "function main(): Uint256 {\n  svm.call(Account.systemProgram, [X], hex``);\n  return 0;\n}\n";
  it.each([
    ["Solana.self.lamports", "pot.balance", value("Uint256")],
    ["Solana.self.balance", "pot.balance", value("Uint256")],
    ["Solana.self.SOL", "pot.balance", value("Uint256")],
    ["Solana.self.USDC", "pot.USDC", value("Uint256")],
    ["Solana.self.dataLen", "pot.dataLen", value("Uint256")],
    ["Solana.self.owner", "Account(pot.address).owner", value("Uint256")],
    ["Solana.self.address", "pot.address", value("Address")],
    ["Solana.self", "pot", value("Address")],
    ["Solana.self.key", "pot", value("Address")],
    ["Solana.self.signer().writable()", "pot.signer().writable()", account],
    // A scalar method is the Pot's key's, as on `pot` (`pot.address.toBytesBe(32)`).
    ["Solana.self.toBytesBe(32)", "pot.toBytesBe(32)", value("bytes")],
    ["Solana.self.toBytesLe(8)", "pot.toBytesLe(8)", value("bytes")],
  ])("%s names %s, which compiles on solana", (site, instead, program) => {
    expect(refusal(program.replace("X", site))).toBe(
      `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
        "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).",
    );
    expect(compile(program.replace("X", instead)).bytecode.length).toBeGreaterThan(0);
  });
});

describe("where a site stands", () => {
  it("a script is given the main it runs as, its declarations left at the top level", () => {
    const program = compile(
      "// Holds the Pot to 5 USDC.\n" +
        'import { decimals } from "@sauce/token";\n' +
        "function floor(): Uint256 {\n  return 5;\n}\n" +
        'require(pot.USDC >= floor(), "low");\n',
    );
    expect(program.source).toContain(
      "// Holds the Pot to 5 USDC.\n" +
        'import { decimals } from "@sauce/token";\n' +
        "function floor(): Uint256 {\n  return 5;\n}\n" +
        "function main(potUSDC: Account, pot: Account<Signer>): void {\n\n" +
        'require(__sauce_svm_balance(USDC, potUSDC, pot.address) >= floor(), "low");\n}\n',
    );
    expect(program.derivedAccounts).toEqual({ potUSDC: "pot:USDC", pot: "pot" });
    expect(program.entryParams).toEqual([]);
    // A script with nothing to lower is left as it is.
    const plain = 'require(ctx.chainId() > 0, "chain");\n';
    expect(compile(plain).source).toBe(plain);
  });

  it("a top-level function is given the accounts it uses, and those of every function it calls, as one list", () => {
    const program = compile(
      "function held(): Uint256 {\n  return pot.USDC;\n}\n" +
        "function twice(): Uint256 {\n  return held() + held();\n}\n" +
        "function both(): Uint256 {\n  return twice() + pot.owner.balance;\n}\n" +
        "function lamports(extra: Uint256): Uint256 {\n  return pot.owner.balance + extra;\n}\n" +
        "function main(): Uint256 {\n  return both() + lamports(1) + pot.balance;\n}\n",
    );
    expect(program.source).toContain(
      "function held(__sauce_accounts: Account[]): Uint256 {\n" +
        "  return __sauce_svm_balance(USDC, __sauce_accounts[0], __sauce_accounts[1].address);\n}\n" +
        "function twice(__sauce_accounts: Account[]): Uint256 {\n" +
        "  return held(__sauce_accounts) + held(__sauce_accounts);\n}\n" +
        "function both(__sauce_accounts: Account[]): Uint256 {\n" +
        "  return twice([__sauce_accounts[0], __sauce_accounts[1]]) + ctx.balance(__sauce_accounts[2].address);\n}\n" +
        "function lamports(extra: Uint256, __sauce_accounts: Account[]): Uint256 {\n" +
        "  return ctx.balance(__sauce_accounts[0].address) + extra;\n}\n" +
        "function main(potUSDC: Account, pot: Account<Signer>, owner: Account<Signer>): Uint256 {\n" +
        "  return both([potUSDC, pot, owner]) + lamports(1, [owner]) + ctx.balance(pot.address);\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ potUSDC: "pot:USDC", pot: "pot", owner: "owner" });
    // A program that names `__sauce_accounts` itself is refused: the name is the lowering's.
    expect(
      refusal(
        "function held(__sauce_accounts: Uint256): Uint256 {\n  return pot.USDC;\n}\nfunction main(): Uint256 {\n  return held(1);\n}\n",
      ),
    ).toContain("`__sauce_accounts` is reserved");
  });

  it("a shorthand { pot } keeps its key, in main and in a top-level function given the accounts", () => {
    const record = "  const r = { size: 1, pot };\n  return r.pot;\n}\n";
    expect(compile(`function main(): Address {\n${record}`).source).toBe(
      "function main(pot: Account<Signer>): Address {\n  const r = { size: 1, pot: pot.address };\n  return r.pot;\n}\n",
    );
    expect(
      compile(
        `function held(): Address {\n${record}function main(): Address {\n  return held();\n}\n`,
      ).source,
    ).toBe(
      "function held(__sauce_accounts: Account[]): Address {\n" +
        "  const r = { size: 1, pot: __sauce_accounts[0].address };\n  return r.pot;\n}\n" +
        "function main(pot: Account<Signer>): Address {\n  return held([pot]);\n}\n",
    );
  });

  it("a token write in a helper: its checks where it stands, its accounts' checks at the top of main", () => {
    const key = `0x${"ab".repeat(32)}`;
    const program = compile(
      `function pay(amount: Uint256): void {\n  USDC.transfer(${key}, amount);\n}\n` +
        "function main(amount: Uint256) {\n  pay(amount);\n}\n",
    );
    expect(program.source).toContain(
      "function pay(amount: Uint256, __sauce_accounts: Account[]): void {\n" +
        "  __sauce_transfer(USDC, __sauce_accounts[0], __sauce_accounts[2], __sauce_accounts[3], __sauce_accounts[1], amount);" +
        ` require(svm.sload(__sauce_accounts[3], 32, 32).toBe() == ${key}, "wrong recipient account");\n}\n` +
        "function main(amount: Uint256, tokenProgram: Account, pot: Account<Signer>, potUSDC: Account<Writable>, accountUSDC: Account<Writable>) {\n" +
        "  pay(amount, [tokenProgram, pot, potUSDC, accountUSDC]);\n}\n",
    );
  });

  it("a helper's last argument keeps its parentheses matched around the accounts passed after it", () => {
    const program = compile(
      "function held(extra: Uint256): Uint256 {\n  return pot.USDC + extra;\n}\n" +
        "function main(extra: Uint256): Uint256 {\n  return held((extra)) + held(((extra)));\n}\n",
    );
    expect(program.source).toContain(
      "function main(extra: Uint256, potUSDC: Account, pot: Account<Signer>): Uint256 {\n" +
        "  return held((extra), [potUSDC, pot]) + held(((extra)), [potUSDC, pot]);\n}\n",
    );
  });

  it("a helper with parameters, called twice, is given its accounts after its own arguments each time", () => {
    const program = compile(
      "function held(scale: Uint256, extra: Uint256): Uint256 {\n  return pot.USDC * scale + extra;\n}\n" +
        "function main(extra: Uint256): Uint256 {\n  return held(2, extra) + held(3, 1);\n}\n",
    );
    expect(program.source).toContain(
      "function held(scale: Uint256, extra: Uint256, __sauce_accounts: Account[]): Uint256 {\n" +
        "  return __sauce_svm_balance(USDC, __sauce_accounts[0], __sauce_accounts[1].address) * scale + extra;\n}\n" +
        "function main(extra: Uint256, potUSDC: Account, pot: Account<Signer>): Uint256 {\n" +
        "  return held(2, extra, [potUSDC, pot]) + held(3, 1, [potUSDC, pot]);\n}\n",
    );
  });

  it("an account a helper writes is held to main's parameter, which must be declared Writable", () => {
    const pay =
      "function pay(dest: Account, amount: Uint256): void {\n  USDC.transfer(dest, amount);\n}\n";
    // The same refusal as the transfer written in main, naming main's parameter.
    expect(
      refusal(`${pay}function main(dest: Account, amount: Uint256) {\n  pay(dest, amount);\n}\n`),
    ).toBe(
      "`USDC.transfer(…)` on Solana, in `pay`: its `dest` is a token account the call writes, and " +
        "a function other than main declares no roles: declare main's `dest` as " +
        "`dest: Account<Writable>`.",
    );
    // Through a helper calling the one that writes, held at main's call of the outer one.
    expect(
      refusal(
        `${pay}function outer(to: Account, amount: Uint256): void {\n  pay(to, amount);\n}\n` +
          "function main(dest: Account, amount: Uint256) {\n  outer(dest, amount);\n}\n",
      ),
    ).toContain("in `pay`: its `dest` is a token account the call writes");
    // Anything but a parameter of main is refused: no account expression carries the role.
    expect(
      refusal(
        `${pay}function main(amount: Uint256) {\n  pay(Account.pda(Account.systemProgram, ["a"]), amount);\n}\n`,
      ),
    ).toContain("pass it a parameter of main declared `Account<Writable>`");
    const writable = compile(
      `${pay}function outer(to: Account, amount: Uint256): void {\n  pay(to, amount);\n}\n` +
        "function main(dest: Account<Writable>, amount: Uint256) {\n  outer(dest, amount);\n}\n",
    );
    expect(roles(writable).dest).toBe("writable");
  });

  it("a helper main never reaches adds no accounts: one that would is refused", () => {
    const key = `0x${"ab".repeat(32)}`;
    expect(
      refusal(
        `function pay(amount: Uint256): void {\n  USDC.transfer(${key}, amount);\n}\n` +
          "function main(): Uint256 {\n  return 1;\n}\n",
      ),
    ).toBe(
      "`pay` uses accounts the lowering adds to main (tokenProgram, pot, potUSDC, accountUSDC), " +
        "and main never calls it: they would be attached to every cook for code that never runs. " +
        "Call `pay` from main, or remove it.",
    );
    expect(
      refusal(
        "function held(): Uint256 {\n  return pot.USDC;\n}\nfunction unused(): Uint256 {\n  return held();\n}\n" +
          "function main(): Uint256 {\n  return 1;\n}\n",
      ),
    ).toMatch(
      /^`held` uses accounts the lowering adds to main \(potUSDC, pot\), and main never calls it/,
    );
    // A helper that uses only its own account parameter adds nothing, reached or not.
    const size = compile(
      "function size(a: Account): Uint256 {\n  return a.balance;\n}\nfunction main(): Uint256 {\n  return 1;\n}\n",
    );
    expect(size.derivedAccounts).toEqual({});
    expect(size.source).toContain("function main(): Uint256 {");
  });

  it("a venue's swap in a helper: its seventeen accounts in one list, its stop's run count unknown", () => {
    const source =
      "function buy(amount: Uint256, limit: Uint256): Uint256 {\n" +
      "  return Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amount, limit, 0);\n}\n" +
      "function main(amount: Uint256, limit: Uint256): Uint256 {\n  return buy(amount, limit);\n}\n";
    const program = compile(source);
    const [stop] = program.stoppable!;
    expect(program.stoppableRuns).toEqual({ [stop!]: null });
    expect(program.source).toMatch(/return buy\(amount, limit, \[\w+(, \w+){16}\]\);/);
    // Held to its stop, the stop is passed under main's name for it.
    const held = compileSauceProgram("solana", source, { stops: [stop!] });
    expect(held.source).toMatch(
      /function buy\(amount: Uint256, limit: Uint256, __sauce_accounts: Account\[\], \w+Stop: Uint256\)/,
    );
    expect(held.source).toMatch(/return buy\(amount, limit, \[[^\]]+\], \w+Stop\);/);
  });

  it("refuses a helper with sites used other than by calling it, or called from a nested function", () => {
    expect(
      refusal(
        "function held(): Uint256 {\n  return pot.USDC;\n}\nfunction main(): Uint256 {\n  const f = held;\n  return 1;\n}\n",
      ),
    ).toBe(
      "`held` uses accounts the lowering adds to main (potUSDC, pot), which it takes as " +
        "parameters, passed at each call: it can only be called by name, and here it is a value " +
        "(`f = held`). Call `held` directly, or write what it does where it is used.",
    );
    expect(
      refusal(
        'import IThing from "./thing.abi.json";\n' +
          "function fallback(error: bytes): Uint256 {\n  return pot.USDC;\n}\n" +
          "function main(thing: Address): Uint256 {\n  return IThing.at(thing).get().catch(fallback);\n}\n",
      ),
    ).toMatch(
      /^`fallback` uses accounts the lowering adds to main \(potUSDC, pot\), which it takes as parameters, passed at each call: it can only be called by name, and here it is a `\.catch` handler, which the program calls with the error alone\./,
    );
    expect(
      refusal(
        "function held(): Uint256 {\n  return pot.USDC;\n}\nfunction main(): Uint256 {\n  const p = program((): Uint256 => held());\n  return 1;\n}\n",
      ),
    ).toMatch(
      /^`held` uses accounts .*: here it is called from a function inside another, which has no accounts to pass\./,
    );
    expect(
      refusal(
        "function main(): Uint256 {\n  const p = program((): Uint256 => pot.USDC);\n  return 1;\n}\n",
      ),
    ).toMatch(/^`pot\.USDC` on Solana stands in a function inside another/);
  });
});

describe("one scoping rule: a name is the binding in scope where it is read", () => {
  it("a loop's record that hides an Account parameter is read for its own field", () => {
    const source =
      "interface Leg { balance: Uint256; address: Address }\n" +
      "function main(a: Account, legs: Leg[]): Uint256 { let total = 0; for (const a of legs) { total += a.balance; } return total; }";
    expect(compile(source).source).toBe(source);
    // Outside the loop, `a` is the parameter, and its `.balance` its lamports.
    expect(compile(source.replace("return total;", "return total + a.balance;")).source).toContain(
      "{ total += a.balance; } return total + ctx.balance(a.address);",
    );
  });

  it("a record bound in one function says nothing of a parameter of the same name in another", () => {
    const program = compile(
      "function helper(): Uint256 {\n  const pool = { balance: 1 };\n  return pool.balance;\n}\n" +
        "function main(pool: Address): Uint256 {\n  return pool.balance + helper();\n}\n",
    );
    expect(program.source).toContain("return pool.balance;");
    expect(program.source).toContain("return ctx.balance(pool) + helper();");
    expect(program.derivedAccounts).toEqual({ poolAccount: "@pool" });
  });

  it("a loop's binding that hides an Address parameter is no key the cook can attach", () => {
    expect(
      refusal(
        "function main(to: Address, list: Address[]) {\n  for (const to of list) {\n    USDC.transfer(to, 1);\n  }\n}\n",
      ),
    ).toMatch(
      /^`USDC\.transfer\(…\)` on Solana: the recipient must be known when the transaction is built/,
    );
  });

  it("two locals of one name in sibling blocks each hold what they are bound to", () => {
    const program = compile(
      "function main(c: bool): Uint256 {\n" +
        "  if (c) {\n    const h = pot;\n    return h.balance;\n  }\n" +
        "  const h = { balance: 2 };\n  return h.balance;\n}\n",
    );
    expect(program.source).toContain("const h = pot.address;\n    return ctx.balance(h);");
    expect(program.source).toContain("const h = { balance: 2 };\n  return h.balance;");
  });
});
