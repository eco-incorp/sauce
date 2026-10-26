/**
 * Accounts as expressions on Solana (`svm-account-expressions.ts`): `pot`, `owner`, `Account(…)`,
 * `Account.pda(…)`, the program accounts, `USDC.accountOf(…)`, `USDC.mint` and `USDC.tokenProgram`,
 * each lowered to a parameter added to `main` with how it is derived, its role from
 * `.writable()`/`.signer()`. Compiled through the real compiler; executed in
 * `cli-solana-token-methods.e2e.test.ts`.
 *
 * Every program in `fixtures/svm-account-spellings` compiled, in the spelling `Account.*` and `owner`
 * retired (`Solana.pda(…)`, `Solana.account(…)`, `Solana.owner`, `Solana.<x>Program`), to what its
 * `retired.json` records; written the new way, it compiles to the same accounts, roles and source,
 * and so to the same bytecode.
 */
import { readFileSync } from "node:fs";
import { getAddressCodec } from "@solana/kit";

import { CASES, RETIRED, migrated } from "./fixtures/svm-account-spellings/cases.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceProgramOptions,
} from "../src/routes/sauce-route.js";
import { hexKey } from "../src/routes/svm-lowering.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/svm/token-program.js";

const compile = (source: string, options: SauceProgramOptions = {}) =>
  compileSauceProgram("solana", source, options);
const compileOn = (chain: string, source: string, options: SauceProgramOptions = {}) =>
  compileSauceProgram(chain, source, options);
const roles = (program: CompiledSauceProgram) =>
  Object.fromEntries(
    program.manifest!.accounts.flatMap((slot) =>
      slot.kind === "slot" ? [[slot.name, slot.requires]] : [],
    ),
  );
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** What a program in the retired spelling compiled to (`fixtures/svm-account-spellings`). */
interface Golden {
  readonly derivedAccounts?: Readonly<Record<string, string>>;
  readonly accounts?: readonly unknown[];
  readonly entryParams: readonly string[];
  readonly source: string;
}
const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/svm-account-spellings/retired.json", import.meta.url), "utf8"),
) as Readonly<Record<string, Golden>>;

describe("accounts as expressions on Solana", () => {
  it("writes an account where it is used: each added to main, with its derivation and role", () => {
    const program = compile(
      "function main(program: Address, owner: Address, amount: Uint256) {\n" +
        "  svm.call(Account(program), [\n" +
        '    Account.pda(program, ["state", owner]).writable(),\n' +
        "    USDC.accountOf(ctx.self()).writable(),\n" +
        "    Account.systemProgram,\n" +
        "  ], amount.toBytesLe(8));\n" +
        "}\n",
    );
    expect(program.source).toContain(
      "svm.call(programAccount, [\n    statePda,\n    potUSDC,\n    systemProgram,\n  ]",
    );
    // `owner` is main's own parameter here: a seed of its key, not the Pot's owner.
    expect(program.derivedAccounts).toEqual({
      programAccount: "@program",
      statePda: 'pda:@program:"state",@owner',
      potUSDC: "authority:USDC",
      pot: "authority",
      systemProgram: "11111111111111111111111111111111",
    });
    expect(roles(program)).toEqual({
      programAccount: "readonly",
      statePda: "writable",
      potUSDC: "writable",
      pot: "readonly_signer",
      systemProgram: "readonly",
    });
    // The arguments are main's own; the accounts are none of them.
    expect(program.entryParams.map((param) => param.name)).toEqual(["program", "owner", "amount"]);
    // Each account is held to its derivation at the top of main, before the program's own code:
    // a key to its key, an address to the engine's own derivation of it, a token account to its
    // holder, a program to its id.
    expect(program.source).toContain(
      "{\n" +
        '  require(programAccount.address == program, "wrong account");\n' +
        '  const [__sauce_pda1, __sauce_bump1] = crypto.findPDA(program, ["state", owner.toBytesBe(32)]);\n' +
        '  require(statePda.address == __sauce_pda1, "wrong program-derived address");\n' +
        '  require(__sauce_ownerOf(USDC, potUSDC) == pot.address, "wrong holder account");\n' +
        `  require(systemProgram.address == 0x${"00".repeat(32)}, "wrong program");\n` +
        "  svm.call(",
    );
  });

  it("holds a key written out to that key, and names it in order", () => {
    const key = `0x${"aa".repeat(32)}`;
    const program = compile(
      `function main(): Uint256 {\n  return Account(${key}).dataLen + Account(0x${"bb".repeat(32)}).dataLen;\n}\n`,
    );
    expect(program.derivedAccounts).toEqual({
      account1: getAddressCodec().decode(new Uint8Array(32).fill(0xaa)),
      account2: getAddressCodec().decode(new Uint8Array(32).fill(0xbb)),
    });
    expect(program.source).toContain(`require(account1.address == ${key}, "wrong account");`);
  });

  it("holds the owner by its signature wherever an account is made of it", () => {
    const program = compile(
      "function main(): Uint256 {\n  return PYUSD.accountOf(owner).dataLen + PYUSD.mint.dataLen;\n}\n",
    );
    expect(roles(program)).toMatchObject({ owner: "readonly_signer", ownerPYUSD: "readonly" });
    expect(program.source).toContain(
      'require(__sauce_ownerOf(PYUSD, ownerPYUSD) == owner.address, "wrong holder account");',
    );
    expect(program.source).toContain('require(mintPYUSD.address == PYUSD, "wrong mint");');
  });

  it("makes every kind of seed, and names a program by its account", () => {
    const key = `0x${"aa".repeat(32)}`;
    const base58 = getAddressCodec().decode(new Uint8Array(32).fill(0xaa));
    const program = compile(
      "function main(user: Address, index: Uint256): Uint256 {\n" +
        "  const vault = Account.pda(Account.associatedTokenProgram, [\n" +
        '    "vault-state", user, pot, owner, ctx.self(), USDC, USDC.mint,\n' +
        `    Account.tokenProgram, index.toBytesLe(8), (7).toBytesLe(2), ${key}, hex\`0102\`,\n` +
        "  ]);\n" +
        "  return vault.dataLen;\n}\n",
    );
    expect(program.derivedAccounts).toMatchObject({
      vaultPda:
        'pda:ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL:"vault-state",@user,pot,owner,pot,' +
        `mint:USDC,mint:USDC,TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA,u64:@index,u16:7,${base58},0x0102`,
    });
  });

  it("names an address for the constant it initializes, else its first string seed", () => {
    const program = compile(
      "function main(to: Address, program: Address): Uint256 {\n" +
        "  const dest = Account.pda(Account.associatedTokenProgram, [to, Account.tokenProgram, USDC]).writable();\n" +
        '  return dest.dataLen + Account.pda(program, [to, "fee-vault"]).dataLen + Account.pda(program, [to]).dataLen;\n' +
        "}\n",
    );
    expect(Object.keys(program.derivedAccounts!)).toEqual(["destPda", "feeVaultPda", "pda3"]);
    expect(program.source).toContain("const dest = destPda;");
  });

  it("is one parameter however often it is written, its role every role any use gives it", () => {
    const program = compile(
      "function main(owner: Address): Uint256 {\n" +
        "  const a = pot.signer();\n" +
        "  const b = pot.writable();\n" +
        "  return pot.dataLen + USDC.accountOf(owner).dataLen + USDC.accountOf(owner).dataLen;\n" +
        "}\n",
    );
    expect(program.derivedAccounts).toEqual({ pot: "pot", ownerUSDC: "@owner:USDC" });
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

  it("names a Token-2022 mint's program, and the owner's and the Pot's accounts", () => {
    const program = compile(
      "function main(): Uint256 {\n" +
        "  return PYUSD.tokenProgram.dataLen + PYUSD.accountOf(owner).dataLen +\n" +
        "    PYUSD.accountOf(pot).dataLen;\n}\n",
    );
    // Each holder's key, which the check compares with, is an account too: the owner and the Pot.
    expect(program.derivedAccounts).toEqual({
      token2022Program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ownerPYUSD: "owner:PYUSD",
      owner: "owner",
      potPYUSD: "pot:PYUSD",
      pot: "pot",
    });
  });

  describe("refusals, each naming what to write instead", () => {
    it("a seed computed as the program runs", () => {
      expect(() =>
        compile(
          "function main(program: Address): Uint256 {\n  const x = 5;\n" +
            '  return Account.pda(program, ["a", x]).dataLen;\n}\n',
        ),
      ).toThrow(
        "`Account.pda(…)` on Solana: the seed `x` must be known when the transaction is built — a " +
          "string, a parameter of main declared `Address`, an integer parameter's `.toBytesLe(n)`, " +
          "`pot`, `ctx.self()`, `owner`, a token symbol",
      );
    });

    it("an integer seed with no width, or a width a seed does not take", () => {
      expect(() =>
        compile(
          'function main(program: Address, n: Uint256): Uint256 {\n  return Account.pda(program, ["a", n]).dataLen;\n}\n',
        ),
      ).toThrow("the seed `n` must be known");
      expect(() =>
        compile(
          "function main(program: Address, n: Uint256): Uint256 {\n  return Account.pda(program, [n.toBytesLe(3)]).dataLen;\n}\n",
        ),
      ).toThrow("an integer seed takes 1, 2, 4, 8 or 16 bytes");
    });

    it("a program or a key computed as the program runs, and an account where a holder's key goes", () => {
      expect(() =>
        compile(
          'function main(): Uint256 {\n  const p = 1;\n  return Account.pda(p, ["a"]).dataLen;\n}\n',
        ),
      ).toThrow(
        "`Account.pda(…)` on Solana: the program `p` must be known when the transaction is built — " +
          "a parameter of main declared `Address`, a 32-byte key, or a program account such as " +
          "`Account.tokenProgram`.",
      );
      expect(() =>
        compile("function main(): Uint256 {\n  const k = 1;\n  return Account(k).dataLen;\n}\n"),
      ).toThrow("`Account(…)` on Solana: the key `k` must be known when the transaction is built");
      expect(() =>
        compile("function main(a: Account): Uint256 {\n  return USDC.accountOf(a).dataLen;\n}\n"),
      ).toThrow("`a` is an account, not a holder's key");
    });

    it("a hex seed that is not whole bytes, a quote or backslash in a string, an integer past its width", () => {
      const pda = (seed: string) =>
        compile(
          `function main(program: Address): Uint256 {\n  return Account.pda(program, [${seed}]).dataLen;\n}\n`,
        );
      expect(() => pda("hex`0`")).toThrow("the seed `hex`0`` must be known");
      expect(() => pda("hex`zz`")).toThrow("the seed `hex`zz`` must be known");
      expect(() => pda('"a\\"b"')).toThrow("must be known when the transaction is built");
      expect(() => pda("(300).toBytesLe(1)")).toThrow("300 does not fit the seed's 1 bytes");
    });

    it("no seeds, or more than 16", () => {
      const pda = (seeds: string) =>
        compile(
          `function main(program: Address): Uint256 {\n  return Account.pda(program, [${seeds}]).dataLen;\n}\n`,
        );
      expect(() => pda("")).toThrow("an address derives from 1 to 16 seeds");
      expect(() => pda(Array(17).fill('"a"').join(", "))).toThrow(
        "an address derives from 1 to 16 seeds",
      );
    });

    it("the wrong arguments, a member Account does not have, and Account read as a value", () => {
      expect(() =>
        compile(
          "function main(a: Address, b: Address): Uint256 {\n  return Account(a, b).dataLen;\n}\n",
        ),
      ).toThrow("`Account(…)` takes 1 argument (key), got 2.");
      expect(() =>
        compile("function main(p: Address): Uint256 {\n  return Account.pda(p).dataLen;\n}\n"),
      ).toThrow("`Account.pda(…)` takes 2 arguments (program, [seeds…]).");
      // An account's `.owner` is the program that owns it: the Pot's owner is `owner`.
      expect(() =>
        compile("function main(): Uint256 {\n  return Account.owner.dataLen;\n}\n"),
      ).toThrow(
        "`Account.owner` on Solana: the Pot's owner is `owner` (`owner.address`, its key; " +
          "`owner.signer()`); an account's `.owner` is the program that owns it.",
      );
      const members =
        "`Account` names an account: `Account(key)`, `Account.pda(program, [seeds])`, " +
        "`Account.systemProgram`, `Account.tokenProgram`, `Account.token2022Program`, " +
        "`Account.associatedTokenProgram` or `Account.memoProgram`.";
      expect(() =>
        compile("function main(): Uint256 {\n  return Account.systemProgramm.dataLen;\n}\n"),
      ).toThrow(`\`Account.systemProgramm\` on Solana: ${members}`);
      expect(() =>
        compile(
          "function main(p: Address): Uint256 {\n  const derive = Account.pda;\n  return 1;\n}\n",
        ),
      ).toThrow(`\`Account.pda\` on Solana: ${members}`);
      expect(() =>
        compile("function main(): Uint256 {\n  const make = Account;\n  return 1;\n}\n"),
      ).toThrow(`\`Account\` on Solana: ${members}`);
    });

    it("an account written in a function inside another", () => {
      expect(() =>
        compile(
          "function main(): Uint256 {\n  const size = program((): Uint256 => Account.systemProgram.dataLen);\n  return 1;\n}\n",
        ),
      ).toThrow(
        "`Account.systemProgram` on Solana stands in a function inside another: the accounts an " +
          "account moves through are added to main and passed to each top-level function that " +
          "uses them, which a function inside another cannot take.",
      );
    });
  });

  it("reads the program of a mint the compile gives itself as the cook is built, and holds it to a token program", () => {
    const mint = new Uint8Array(32).fill(0xcc);
    const program = compile(
      "function main(): Uint256 {\n  return PYUSD.tokenProgram.dataLen;\n}\n",
      {
        defines: { PYUSD: BigInt(`0x${"cc".repeat(32)}`) },
      },
    );
    expect(program.derivedAccounts).toEqual({
      programPYUSD: `program:${getAddressCodec().decode(mint)}`,
    });
    expect(program.source).toContain(
      `require(programPYUSD.address == ${hexKey(TOKEN_PROGRAM_ID)} || programPYUSD.address == ${hexKey(TOKEN_2022_PROGRAM_ID)}, "wrong program");`,
    );
  });

  it("leaves a program that declares Solana or Account itself, and the explicit Account parameters, as they are", () => {
    const explicit =
      "function main(state: Account<Writable>, program: Account): Uint256 {\n  return state.dataLen + program.dataLen;\n}\n";
    expect(compile(explicit).derivedAccounts).toBeUndefined();
    expect(compile(explicit).source).toBe(explicit);
    const own = "const Solana = 7;\nfunction main(): Uint256 {\n  return Solana;\n}\n";
    expect(compile(own).source).toBe(own);
    const factory =
      "function Account(key: Address): Uint256 {\n  return key;\n}\n" +
      "function main(k: Address): Uint256 {\n  return Account(k);\n}\n";
    expect(compile(factory).derivedAccounts).toBeUndefined();
    expect(compile(factory).source).toBe(factory);
  });

  it("reads Account as the type wherever a type is written, and as an account where a value is", () => {
    const key = `0x${"aa".repeat(32)}`;
    const program = compile(
      "function size(account: Account): Uint256 {\n  return account.dataLen;\n}\n" +
        "function main(a: Account<Writable>, b: Account): Uint256 {\n" +
        `  const c: Account = Account(${key});\n` +
        "  return size(a) + size(b) + size(c);\n}\n",
    );
    expect(program.derivedAccounts).toEqual({
      account1: getAddressCodec().decode(new Uint8Array(32).fill(0xaa)),
    });
    expect(program.source).toContain(
      "function main(a: Account<Writable>, b: Account, account1: Account): Uint256 {",
    );
    expect(program.source).toContain("const c: Account = account1;");
  });
});

describe("every account spelling, written the new way, compiles as the retired one did", () => {
  it("covers every case its fixture records, each in a spelling now retired", () => {
    expect(CASES.map((one) => one.name).sort()).toEqual(Object.keys(GOLDEN).sort());
    for (const { old } of CASES) {
      expect(migrated(old)).not.toBe(old);
      expect(migrated(old)).not.toMatch(/\bSolana\./);
    }
  });

  it.each(CASES.map((one) => [one.name, one.old] as const))("%s", (name, old) => {
    const golden = GOLDEN[name]!;
    const program = compile(migrated(old));
    expect(program.derivedAccounts).toEqual(golden.derivedAccounts);
    expect(program.manifest?.accounts).toEqual(golden.accounts);
    expect(program.entryParams.map((param) => param.name)).toEqual(golden.entryParams);
    expect(program.source).toBe(golden.source);
    // The retired spelling's lowered program, compiled: its bytecode, byte for byte.
    expect(hex(program.bytecode)).toBe(hex(compile(golden.source).bytecode));
  });
});

describe("the retired spellings, each refused naming what to write", () => {
  const main = (body: string) =>
    `function main(program: Address, key: Address): Uint256 {\n${body}\n}\n`;

  it.each(RETIRED.map((one) => [one.spelling, one] as const))("%s", (_, { read, refusal }) => {
    // Where the program runs it, in code a test of a name rules out, and on an EVM chain.
    expect(() => compile(main(`  return ${read};`))).toThrow(refusal);
    expect(() => compile(main(`  if (WETH) {\n    return ${read};\n  }\n  return 1;`))).toThrow(
      refusal,
    );
    expect(() => compileOn("base", main(`  return ${read};`))).toThrow(refusal);
  });

  it("leaves Solana's own names alone where the program declares Solana", () => {
    const own =
      "function main(): Uint256 {\n  const Solana = { owner: 7 };\n  return Solana.owner;\n}\n";
    expect(compile(own).source).toBe(own);
  });
});

describe("owner, the Pot's owner", () => {
  it("is the name of a program that declares it, wherever it does", () => {
    // Main's parameter, a top-level constant, a local, and the binding of the Pot's key.
    for (const own of [
      "function main(owner: Address): Uint256 {\n  return owner;\n}\n",
      "const owner = 7;\nfunction main(): Uint256 {\n  return owner;\n}\n",
      "function main(wallet: Account<Signer>): Uint256 {\n  const owner = wallet.address;\n  return owner;\n}\n",
    ]) {
      const program = compile(own);
      expect(program.derivedAccounts).toBeUndefined();
      expect(program.source).toBe(own);
    }
  });

  it("is the program's only where its declaration is in scope", () => {
    const program = compile(
      "function check(owner: Address): Uint256 {\n  return owner;\n}\n" +
        "function main(): Uint256 {\n  return check(owner.address);\n}\n",
    );
    // `check`'s parameter takes the name, so the owner's slot is named apart from it.
    expect(program.derivedAccounts).toEqual({ owner2: "owner" });
    expect(program.source).toContain("function check(owner: Address): Uint256 {\n  return owner;");
    expect(program.source).toContain("return check(owner2.address);");
  });

  it("is the caller's value where the compile binds it", () => {
    const source = "function main(): Uint256 {\n  return owner;\n}\n";
    const program = compile(source, { defines: { owner: 5n } });
    expect(program.derivedAccounts).toBeUndefined();
    expect(program.source).toBe(source);
  });

  it("is written out in a record's shorthand field, as its own field would be", () => {
    const shorthand = compile(
      "function main(): Uint256 {\n  const r = { owner };\n  return r.owner.dataLen;\n}\n",
    );
    const field = compile(
      "function main(): Uint256 {\n  const r = { owner: owner };\n  return r.owner.dataLen;\n}\n",
    );
    expect(shorthand.source).toContain("const r = { owner: owner };");
    expect(shorthand.derivedAccounts).toEqual({ owner: "owner" });
    expect(hex(shorthand.bytecode)).toBe(hex(field.bytecode));
    // Its slot named apart, where a declaration elsewhere takes `owner`.
    const apart = compile(
      "function id(owner: Uint256): Uint256 {\n  return owner;\n}\n" +
        "function main(): Uint256 {\n  const r = { owner };\n  return r.owner.dataLen + id(1);\n}\n",
    );
    expect(apart.source).toContain("const r = { owner: owner2 };");
  });
});

describe("accounts are Solana's", () => {
  const reads: ReadonlyArray<readonly [string, string]> = [
    ["`Account(…)`", "function main(to: Address): Uint256 {\n  return Account(to).dataLen;\n}\n"],
    [
      "`Account.pda(…)`",
      'function main(program: Address): Uint256 {\n  return Account.pda(program, ["a"]).dataLen;\n}\n',
    ],
    [
      "`Account.systemProgram`",
      "function main(): Uint256 {\n  return Account.systemProgram.dataLen;\n}\n",
    ],
    ["`owner`", "function main(): Uint256 {\n  return owner.dataLen;\n}\n"],
    ["`owner`", "function main(): Uint256 {\n  return owner;\n}\n"],
  ];

  it.each(reads)("refuses %s on an EVM chain", (spelled, source) => {
    for (const chain of ["base", "ethereum"]) {
      expect(() => compileOn(chain, source)).toThrow(
        `${spelled} on ${chain}: accounts are Solana's`,
      );
    }
  });

  it("takes a declared owner, the Account type and a caller's owner on an EVM chain", () => {
    expect(() =>
      compileOn("base", "function main(owner: Address): Uint256 {\n  return owner;\n}\n"),
    ).not.toThrow();
    expect(() =>
      compileOn("base", "function main(a: Account): Uint256 {\n  return a;\n}\n"),
    ).not.toThrow();
    expect(() =>
      compileOn("base", "function main(): Uint256 {\n  return owner;\n}\n", {
        defines: { owner: 5n },
      }),
    ).not.toThrow();
  });

  it("lets code a test of a name rules out on an EVM chain name Solana's accounts", () => {
    expect(() =>
      compileOn(
        "base",
        "function main(): Uint256 {\n" +
          "  if (WSOL) {\n    return Account.systemProgram.dataLen + owner.dataLen + Account(pot).dataLen;\n  }\n" +
          "  return 1;\n}\n",
      ),
    ).not.toThrow();
  });
});
