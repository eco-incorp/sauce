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
      "function main(pot: Account): Address {\n  return pot.address;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ pot: "pot" });
    expect(hex("function main(a: Address): bool {\n  return a == pot && pot != 0;\n}\n")).toBe(
      hex(
        "function main(a: Address, pot: Account): bool {\n  return a == pot.address && pot.address != 0;\n}\n",
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
        "  svm.call(Solana.systemProgram, [pot.signer(), pot.writable(), pot], data);\n" +
        "  return pot.dataLen + pot.owner + svm.sload(pot, 0, 8).toLe() + size(pot);\n" +
        "}\n",
    );
    expect(program.source).toContain(
      "  svm.call(systemProgram, [pot, pot, pot], data);\n" +
        "  return pot.dataLen + pot.owner + svm.sload(pot, 0, 8).toLe() + size(pot);",
    );
    expect(program.derivedAccounts).toEqual({
      systemProgram: "11111111111111111111111111111111",
      pot: "pot",
    });
    expect(roles(program)).toEqual({ systemProgram: "readonly", pot: "writable_signer" });
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

  it("a local bound to bare pot holds what its declared type says: the Pot's key, else its account", () => {
    // An `Address` alias, annotated or not, is the Pot's key: its `.balance` the lamports there.
    for (const declared of [": Address", ""]) {
      const program = compile(
        `function main(): Uint256 {\n  const holder${declared} = pot;\n  return holder.balance;\n}\n`,
      );
      expect(program.source).toBe(
        `function main(pot: Account): Uint256 {\n  const holder${declared} = pot.address;\n  return ctx.balance(holder);\n}\n`,
      );
      expect(program.derivedAccounts).toEqual({ pot: "pot" });
    }
    // One declared `Account` is the Pot's account, its `.balance` read by its key.
    expect(
      compile(
        "function main(): Uint256 {\n  const holder: Account = pot;\n  return holder.balance;\n}\n",
      ).source,
    ).toBe(
      "function main(pot: Account): Uint256 {\n  const holder: Account = pot;\n  return ctx.balance(holder.address);\n}\n",
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
      "svm.call(Solana.systemProgram, [Solana.self.signer()], hex``); return 0;",
      "Solana.self.signer()",
      "pot.signer()",
    ],
    ['return Solana.pda(Solana.systemProgram, ["a", self]).dataLen;', "self", "pot"],
  ])("%s", (body, site, instead) => {
    expect(refusal(`function main(): Uint256 {\n  ${body}\n}\n`)).toBe(
      `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
        "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).",
    );
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
        "function both(): Uint256 {\n  return twice() + Solana.owner.balance;\n}\n" +
        "function lamports(extra: Uint256): Uint256 {\n  return Solana.owner.balance + extra;\n}\n" +
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
      "function main(pot: Account): Address {\n  const r = { size: 1, pot: pot.address };\n  return r.pot;\n}\n",
    );
    expect(
      compile(
        `function held(): Address {\n${record}function main(): Address {\n  return held();\n}\n`,
      ).source,
    ).toBe(
      "function held(__sauce_accounts: Account[]): Address {\n" +
        "  const r = { size: 1, pot: __sauce_accounts[0].address };\n  return r.pot;\n}\n" +
        "function main(pot: Account): Address {\n  return held([pot]);\n}\n",
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
