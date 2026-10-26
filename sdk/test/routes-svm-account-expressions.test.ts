/**
 * Accounts as expressions on Solana (`svm-account-expressions.ts`): `pot`, `pot.owner`, `Account(…)`,
 * `Account.pda(…)`, the program accounts, `USDC.accountOf(…)`, `USDC.mint` and `USDC.tokenProgram`,
 * each lowered to a parameter added to `main` with how it is derived, its role from
 * `.writable()`/`.signer()`. Compiled through the real compiler; executed in
 * `cli-solana-token-methods.e2e.test.ts`. On an EVM chain `pot.owner` is the Pot's `owner()`
 * (`pot-owner.ts`), executed in `evm/pot-owner.e2e.test.ts`.
 *
 * Every program in `fixtures/svm-account-spellings` compiled, in the spelling `Account.*` and
 * `pot.owner` retired (`Solana.pda(…)`, `Solana.account(…)`, `Solana.owner`, `Solana.<x>Program`),
 * to what its `retired.json` records; written the new way, it compiles to the same accounts, roles
 * and source, and so to the same bytecode.
 */
import { readFileSync } from "node:fs";
import { getAddressCodec } from "@solana/kit";

import { CASES, RETIRED, migrated } from "./fixtures/svm-account-spellings/cases.js";
import { POT_OWNER_ABI, rewritePotOwner } from "../src/routes/pot-owner.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceProgramOptions,
} from "../src/routes/sauce-route.js";
import { hexKey } from "../src/routes/svm-lowering.js";
import { rewriteSvmTokenSyntax } from "../src/routes/svm-token-rewrite.js";
import { svmTokenRows } from "../src/routes/token-registry.js";
import { requireChain } from "../src/chains/canonical.js";
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
      "function main(): Uint256 {\n  return PYUSD.accountOf(pot.owner).dataLen + PYUSD.mint.dataLen;\n}\n",
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
        '    "vault-state", user, pot, pot.owner, ctx.self(), USDC, USDC.mint,\n' +
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
        "  return PYUSD.tokenProgram.dataLen + PYUSD.accountOf(pot.owner).dataLen +\n" +
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
          "`pot`, `ctx.self()`, `pot.owner`, a token symbol",
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
      // An account's `.owner` is the program that owns it: the Pot's owner is `pot.owner`.
      expect(() =>
        compile("function main(): Uint256 {\n  return Account.owner.dataLen;\n}\n"),
      ).toThrow(
        "`Account.owner` on Solana: the Pot's owner is `pot.owner` (`pot.owner.address`, its key; " +
          "`pot.owner.signer()`); an account's `.owner` is the program that owns it.",
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

  it("takes the Pot's key as Account's: Account(pot) is the Pot's own account, its .owner the program that owns it", () => {
    for (const key of ["pot", "pot.address"]) {
      const program = compile(`function main(): Address {\n  return Account(${key}).owner;\n}\n`);
      // The slot the Pot is everywhere: `Account<Signer>`, derived `pot`, whose `.owner` is the
      // compiler's field, the program that owns the Pot's account.
      expect(program.source).toBe(
        "function main(pot: Account<Signer>): Address {\n  return pot.owner;\n}\n",
      );
      expect(program.derivedAccounts).toEqual({ pot: "pot" });
    }
    // One account however it is written.
    const both = compile(
      "function main(): Uint256 {\n  return Account(pot).dataLen + Account(pot.address).dataLen + pot.dataLen;\n}\n",
    );
    expect(both.source).toContain("return pot.dataLen + pot.dataLen + pot.dataLen;");
    expect(both.derivedAccounts).toEqual({ pot: "pot" });
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

  it("says to rename the program's own pot or Account first, which the new spelling would read", () => {
    const rename = (name: string) =>
      `. This program declares its own \`${name}\` here, which that would read: rename it first`;
    const owner = RETIRED.find((one) => one.spelling === "Solana.owner")!;
    // `Solana.owner` is `pot.owner`, which a program's own `pot` would read.
    expect(() =>
      compile("function main(pot: Account): Address {\n  return Solana.owner.address;\n}\n"),
    ).toThrow(`${owner.refusal}${rename("pot")}`);
    // The other spellings are `Account`'s, which a program's own `Account` would read.
    for (const { read, refusal } of RETIRED.filter((one) => one !== owner)) {
      expect(() =>
        compile(
          `function main(program: Address, key: Address, Account: Uint256): Uint256 {\n  return ${read};\n}\n`,
        ),
      ).toThrow(`${refusal}${rename("Account")}`);
    }
    // A compile that binds the name gives it the caller's value, which the advice says.
    expect(() => compile(main(`  return ${owner.read};`), { defines: { pot: 5n } })).toThrow(
      `${owner.refusal}. The compile binds its own \`pot\`, which that would read: rename that first`,
    );
    // A declaration out of scope there reads nothing of it: the advice is the plain one.
    let plain = "";
    try {
      compile(
        `function id(pot: Uint256): Uint256 {\n  return pot;\n}\n${main(`  return ${owner.read} + id(1);`)}`,
      );
    } catch (error) {
      plain = (error as Error).message;
    }
    expect(plain).toContain(owner.refusal);
    expect(plain).not.toContain("rename it first");
  });

  it("leaves Solana's own names alone where the program declares Solana", () => {
    const own =
      "function main(): Uint256 {\n  const Solana = { owner: 7 };\n  return Solana.owner;\n}\n";
    expect(compile(own).source).toBe(own);
  });
});

describe("pot.owner, the Pot's owner", () => {
  it("is the owner's account: its key, and a holder and a seed of its own", () => {
    const program = compile("function main(): Address {\n  return pot.owner.address;\n}\n");
    expect(program.source).toBe(
      "function main(owner: Account): Address {\n  return owner.address;\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ owner: "owner" });
    // Held by its signature where an account is made of it, as `Solana.owner` was.
    const made = compile(
      "function main(program: Address): Uint256 {\n" +
        '  return USDC.accountOf(pot.owner).dataLen + Account.pda(program, ["v", pot.owner]).dataLen;\n}\n',
    );
    expect(made.derivedAccounts).toMatchObject({
      ownerUSDC: "owner:USDC",
      owner: "owner",
      vPda: 'pda:@program:"v",owner',
    });
    expect(roles(made)).toMatchObject({ owner: "readonly_signer" });
  });

  it("names no Pot: a program that reads only its owner acts as the authority", () => {
    const program = compile(
      "function main(to: Address, amount: Uint256) {\n" +
        "  USDC.transfer(to, amount);\n" +
        '  require(pot.owner.address != to, "to is the owner");\n}\n',
    );
    expect(program.derivedAccounts).toMatchObject({
      pot: "authority",
      potUSDC: "authority:USDC",
      owner: "owner",
    });
    expect(program.potMention).toBeUndefined();
    // A program that names the Pot too acts as the Pot, and its mention is the Pot's.
    const both = compile(
      "function main(to: Address, amount: Uint256) {\n" +
        '  require(pot.owner.address != to, "to is the owner");\n' +
        "  USDC.transfer(to, amount);\n" +
        '  require(pot.USDC > 0, "empty");\n}\n',
    );
    expect(both.derivedAccounts).toMatchObject({ pot: "pot", potUSDC: "pot:USDC" });
    expect(both.potMention).toEqual({ line: 4, column: 11 });
  });

  it("leaves a called pot.owner(…) to the compiler, which calls nothing of that name", () => {
    for (const chain of ["solana", "base"]) {
      expect(() =>
        compileOn(chain, "function main(): Address {\n  return pot.owner();\n}\n"),
      ).toThrow("this call does not name a function, builtin, or contract method in scope");
    }
  });

  it("is the program's where the program or the compile gives it a pot, on either chain", () => {
    const record =
      "function main(): Uint256 {\n  const pot = { owner: 7 };\n  return pot.owner;\n}\n";
    const imported =
      'import { pot } from "./lib.js";\nfunction main(): Uint256 {\n  return pot.owner;\n}\n';
    const lib = {
      resolve: (path: string) =>
        path === "./lib.js"
          ? new TextEncoder().encode("export const pot = { owner: 7 };\n")
          : undefined,
    };
    const free = "function main(): Uint256 {\n  return pot.owner;\n}\n";
    for (const chain of ["solana", "base"]) {
      expect(compileOn(chain, record).source).toBe(record);
      expect(compileOn(chain, imported, lib).source).toBe(imported);
      // A define's `pot` is the caller's value, whose `.owner` the compiler reads, and refuses.
      expect(() => compileOn(chain, free, { defines: { pot: 5n } })).toThrow("compilation failed");
    }
    const param = "function main(pot: Account): Address {\n  return pot.owner;\n}\n";
    expect(compile(param).source).toBe(param);
    // A `pot` the caller binds (a define, a contract binding) is never lowered, on either chain.
    const bound = new Set(["pot"]);
    const solana = requireChain("solana");
    expect(
      rewriteSvmTokenSyntax(
        free,
        new Map(),
        svmTokenRows(solana),
        undefined,
        "SOL",
        undefined,
        bound,
      ).rewrote,
    ).toBe(false);
    expect(rewritePotOwner(free, bound)).toEqual({ source: free });
  });

  it("leaves owner an ordinary name: a program's own, and undeclared, no name at all", () => {
    // Main's parameter, a top-level constant, a local, and the binding of an account's key.
    for (const own of [
      "function main(owner: Address): Uint256 {\n  return owner;\n}\n",
      "const owner = 7;\nfunction main(): Uint256 {\n  return owner;\n}\n",
      "function main(wallet: Account<Signer>): Uint256 {\n  const owner = wallet.address;\n  return owner;\n}\n",
    ]) {
      const program = compile(own);
      expect(program.derivedAccounts).toBeUndefined();
      expect(program.source).toBe(own);
    }
    for (const chain of ["solana", "base"]) {
      expect(() => compileOn(chain, "function main(): Address {\n  return owner;\n}\n")).toThrow(
        "`owner` is not a declared variable",
      );
    }
    // A program's own `owner` and the Pot's, side by side: the owner's slot named apart from it.
    const program = compile(
      "function check(owner: Address): Uint256 {\n  return owner;\n}\n" +
        "function main(): Uint256 {\n  return check(pot.owner.address);\n}\n",
    );
    expect(program.derivedAccounts).toEqual({ owner2: "owner" });
    expect(program.source).toContain("return check(owner2.address);");
  });
});

describe("the Pot's members are read, never written", () => {
  it.each(["solana", "base"])("refuses a write to one on %s", (chain) => {
    for (const [statement, target] of [
      ["pot.owner = other;", "pot.owner"],
      ["pot.balance += 1;", "pot.balance"],
      ["pot.USDC++;", "pot.USDC"],
      ["pot[0] = 1;", "pot[0]"],
    ] as const) {
      expect(() =>
        compileOn(
          chain,
          `function main(other: Address): Uint256 {\n  ${statement}\n  return 1;\n}\n`,
        ),
      ).toThrow(`\`${target}\` is written: a member of the Pot is read, never written`);
    }
  });

  it("leaves a program's own pot to the program", () => {
    const own =
      "function main(): Uint256 {\n  const pot = new Array(2);\n  pot[0] = 7;\n  return pot[0];\n}\n";
    for (const chain of ["solana", "base"]) expect(compileOn(chain, own).source).toBe(own);
  });
});

describe("pot.owner on an EVM chain: the Pot's owner()", () => {
  const potOwner = { PotOwner: { abi: [...POT_OWNER_ABI] } };

  it("binds owner() as the released Pot's ABI declares it", () => {
    const pot = JSON.parse(
      readFileSync(new URL("../src/artifacts/V12Pot.json", import.meta.url), "utf8"),
    ) as { abi: readonly unknown[] };
    expect(POT_OWNER_ABI).toHaveLength(1);
    expect(pot.abi).toContainEqual(POT_OWNER_ABI[0]);
  });

  it.each(["base", "ethereum"])("on %s, compiles to the Pot's owner() read", (chain) => {
    const program = compileOn(chain, "function main(): Address {\n  return pot.owner;\n}\n");
    expect(program.derivedAccounts).toBeUndefined();
    expect(hex(program.bytecode)).toBe(
      hex(
        compileOn(
          chain,
          "function main(): Address {\n  return PotOwner.view(ctx.self()).owner();\n}\n",
          {
            contracts: potOwner,
          },
        ).bytecode,
      ),
    );
    // Its balances are the owner's, the native coin's and a token's, each a read of owner().
    const balances = compileOn(
      chain,
      "function main(): Uint256 {\n  return pot.owner.balance + pot.owner.USDC;\n}\n",
    );
    expect(hex(balances.bytecode)).toBe(
      hex(
        compileOn(
          chain,
          "function main(): Uint256 {\n" +
            "  return ctx.balance(PotOwner.view(ctx.self()).owner()) +\n" +
            "    USDC.balanceOf(PotOwner.view(ctx.self()).owner());\n}\n",
          { contracts: potOwner },
        ).bytecode,
      ),
    );
  });

  it("refuses a program that takes the name its read goes through", () => {
    expect(() =>
      compileOn(
        "base",
        "function main(): Address {\n  const __sauce_Pot = 1;\n  return pot.owner;\n}\n",
      ),
    ).toThrow("`__sauce_Pot` is reserved");
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
    ["`Account`", "function main(): Uint256 {\n  const make = Account;\n  return 1;\n}\n"],
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
          "  if (WSOL) {\n    return Account.systemProgram.dataLen + pot.owner.dataLen + Account(pot).dataLen;\n  }\n" +
          "  return 1;\n}\n",
      ),
    ).not.toThrow();
  });

  it("refuses on Solana an Account only an ambient module exports, read free, and on Base compiles the module's", () => {
    const module = "export function Account(k: Uint256): Uint256 {\n  return k + 1;\n}\n";
    const resolve = (path: string) =>
      path === "./caller.ts" ? new TextEncoder().encode(module) : undefined;
    const source = "function main(k: Uint256): Uint256 {\n  return Account(k);\n}\n";
    expect(() => compile(source, { ambient: ["./caller.ts"], resolve })).toThrow(
      "`Account` at line 2, column 10: an ambient module exports `Account`, and the program reads " +
        "it with no import, so it would read that module's value and not Solana's account factory.",
    );
    // Imported by name, it is the program's own, on either chain.
    const imported = `import { Account } from "./caller.ts";\n${source}`;
    expect(compile(imported, { resolve }).derivedAccounts).toBeUndefined();
    // On an EVM chain the module's `Account` is the caller's value, as if the program imported it.
    expect(hex(compileOn("base", source, { ambient: ["./caller.ts"], resolve }).bytecode)).toBe(
      hex(compileOn("base", imported, { resolve }).bytecode),
    );
  });
});
