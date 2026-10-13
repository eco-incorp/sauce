/**
 * Accounts as expressions on Solana (`svm-account-expressions.ts`): `Solana.pda(…)`,
 * `Solana.account(…)`, `Solana.self`, `Solana.owner`, the program accounts, `USDC.accountOf(…)`,
 * `USDC.mint` and `USDC.tokenProgram`, each lowered to a parameter added to `main` with how it is
 * derived, its role from `.writable()`/`.signer()`. Compiled through the real compiler; executed in
 * `cli-solana-token-methods.e2e.test.ts`.
 */
import { getAddressCodec } from "@solana/kit";

import { compileSauceProgram } from "../src/routes/sauce-route.js";

const compile = (source: string) => compileSauceProgram("solana", source);
const roles = (program: ReturnType<typeof compile>) =>
  Object.fromEntries(
    program.manifest!.accounts.map((slot) => {
      const s = slot as { name: string; requires: string };
      return [s.name, s.requires];
    }),
  );

describe("accounts as expressions on Solana", () => {
  it("writes an account where it is used: each added to main, with its derivation and role", () => {
    const program = compile(
      "function main(program: Address, owner: Address, amount: Uint256) {\n" +
        "  svm.call(Solana.account(program), [\n" +
        '    Solana.pda(program, ["state", owner]).writable(),\n' +
        "    USDC.accountOf(ctx.self()).writable(),\n" +
        "    Solana.systemProgram,\n" +
        "  ], amount.toBytesLe(8));\n" +
        "}\n",
    );
    expect(program.source).toContain(
      "svm.call(programAccount, [\n    statePda,\n    potUSDC,\n    systemProgram,\n  ]",
    );
    expect(program.derivedAccounts).toEqual({
      programAccount: "@program",
      statePda: 'pda:@program:"state",@owner',
      potUSDC: "self:USDC",
      systemProgram: "11111111111111111111111111111111",
    });
    expect(roles(program)).toEqual({
      programAccount: "readonly",
      statePda: "writable",
      potUSDC: "writable",
      systemProgram: "readonly",
    });
    // The arguments are main's own; the accounts are none of them.
    expect(program.entryParams.map((param) => param.name)).toEqual(["program", "owner", "amount"]);
  });

  it("makes every kind of seed, and names a program by its account", () => {
    const key = `0x${"aa".repeat(32)}`;
    const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0xaa));
    const program = compile(
      "function main(owner: Address, index: Uint256): Uint256 {\n" +
        "  const vault = Solana.pda(Solana.associatedTokenProgram, [\n" +
        '    "vault-state", owner, Solana.self, Solana.owner, ctx.self(), USDC, USDC.mint,\n' +
        `    Solana.tokenProgram, index.toBytesLe(8), (7).toBytesLe(2), ${key}, hex\`0102\`,\n` +
        "  ]);\n" +
        "  return vault.dataLen;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({
      vaultPda:
        'pda:ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL:"vault-state",@owner,self,owner,self,' +
        `mint:USDC,mint:USDC,TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA,u64:@index,u16:7,${base58},0x0102`,
    });
  });

  it("names an address for the constant it initializes, else its first string seed", () => {
    const program = compile(
      "function main(to: Address, program: Address): Uint256 {\n" +
        "  const dest = Solana.pda(Solana.associatedTokenProgram, [to, Solana.tokenProgram, USDC]).writable();\n" +
        '  return dest.dataLen + Solana.pda(program, [to, "fee-vault"]).dataLen + Solana.pda(program, [to]).dataLen;\n' +
        "}\n",
    );
    expect(Object.keys(program.derivedAccounts!)).toEqual(["destPda", "feeVaultPda", "pda3"]);
    expect(program.source).toContain("const dest = destPda;");
  });

  it("is one parameter however often it is written, its role every role any use gives it", () => {
    const program = compile(
      "function main(owner: Address): Uint256 {\n" +
        "  const a = Solana.self.signer();\n" +
        "  const b = Solana.self.writable();\n" +
        "  return Solana.self.dataLen + USDC.accountOf(owner).dataLen + USDC.accountOf(owner).dataLen;\n" +
        "}\n",
    );
    expect(program.derivedAccounts).toEqual({ pot: "self", ownerUSDC: "@owner:USDC" });
    expect(roles(program)).toEqual({ pot: "writable_signer", ownerUSDC: "readonly" });
  });

  it("shares a parameter with the token methods where they name the same account", () => {
    const program = compile(
      "function main(to: Address, amount: Uint256): Uint256 {\n" +
        "  USDC.transfer(to, amount);\n" +
        "  return svm.sload(USDC.accountOf(to), 64, 8).toLe() + USDC.mint.dataLen;\n" +
        "}\n",
    );
    const names = program.manifest!.accounts.map((slot) => (slot as { name: string }).name);
    expect(names.filter((name) => name === "toUSDC")).toHaveLength(1);
    expect(program.derivedAccounts).toMatchObject({ toUSDC: "@to:USDC", mintUSDC: "mint:USDC" });
  });

  it("names a Token-2022 mint's program and the owner's account", () => {
    const program = compile(
      "function main(): Uint256 {\n  return PYUSD.tokenProgram.dataLen + PYUSD.accountOf(Solana.owner).dataLen;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({
      token2022Program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ownerPYUSD: "owner:PYUSD",
    });
  });

  describe("refusals, each naming what to write instead", () => {
    it("a seed computed as the program runs", () => {
      expect(() =>
        compile(
          "function main(program: Address): Uint256 {\n  const x = 5;\n" +
            '  return Solana.pda(program, ["a", x]).dataLen;\n}\n',
        ),
      ).toThrow(
        "the seed `x` must be known when the transaction is built — a string, a parameter of main " +
          "declared `Address`, an integer parameter's `.toBytesLe(n)`",
      );
    });

    it("an integer seed with no width, or a width a seed does not take", () => {
      expect(() =>
        compile(
          'function main(program: Address, n: Uint256): Uint256 {\n  return Solana.pda(program, ["a", n]).dataLen;\n}\n',
        ),
      ).toThrow("the seed `n` must be known");
      expect(() =>
        compile(
          "function main(program: Address, n: Uint256): Uint256 {\n  return Solana.pda(program, [n.toBytesLe(3)]).dataLen;\n}\n",
        ),
      ).toThrow("an integer seed takes 1, 2, 4, 8 or 16 bytes");
    });

    it("a program or a key computed as the program runs, and an account where a holder's key goes", () => {
      expect(() =>
        compile(
          'function main(): Uint256 {\n  const p = 1;\n  return Solana.pda(p, ["a"]).dataLen;\n}\n',
        ),
      ).toThrow("the program `p` must be known when the transaction is built");
      expect(() =>
        compile(
          "function main(): Uint256 {\n  const k = 1;\n  return Solana.account(k).dataLen;\n}\n",
        ),
      ).toThrow("the key `k` must be known when the transaction is built");
      expect(() =>
        compile("function main(a: Account): Uint256 {\n  return USDC.accountOf(a).dataLen;\n}\n"),
      ).toThrow("`a` is an account, not a holder's key");
    });

    it("an account written in a helper", () => {
      expect(() =>
        compile(
          "function size(): Uint256 {\n  return Solana.systemProgram.dataLen;\n}\nfunction main(): Uint256 {\n  return size();\n}\n",
        ),
      ).toThrow("on Solana stands in `size`: the accounts an account moves through");
    });
  });

  it("leaves a program that declares Solana itself, and the explicit Account parameters, as they are", () => {
    const explicit =
      "function main(state: Account<Writable>, program: Account): Uint256 {\n  return state.dataLen + program.dataLen;\n}\n";
    expect(compile(explicit).derivedAccounts).toBeUndefined();
  });
});
