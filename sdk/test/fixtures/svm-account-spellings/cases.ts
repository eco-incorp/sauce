/**
 * The Solana account spellings a program had before `Account.*` and `owner`, as programs: each one
 * written in the retired spelling (`Solana.pda(…)`, `Solana.account(…)`, `Solana.owner`,
 * `Solana.<x>Program`). `retired.json` beside it holds what each compiled to in that spelling, on
 * main at 6034ed045 before the spellings were retired: the accounts added to `main` with how each
 * is derived, the manifest's roles, `main`'s parameters and the lowered source. The lowered source
 * compiles to the same bytecode again (it lowers to itself), so `routes-svm-account-expressions`
 * holds each program, written the new way (`migrated`), to the same accounts, roles and source, and
 * to the bytecode of that source.
 *
 * A program here declares no `owner` of its own: a declared `owner` owns the name, and the Pot's
 * owner is then written no other way.
 */

/** A program in the retired spelling. */
export interface SpellingCase {
  readonly name: string;
  readonly old: string;
}

/**
 * A retired spelling: how the language reference wrote it, a read of an account written that way
 * (in a `main` that takes `program` and `key`, both `Address`), and what the refusal says.
 */
export interface RetiredSpelling {
  readonly spelling: string;
  readonly read: string;
  readonly refusal: string;
}

const AA = `0x${"aa".repeat(32)}`;
const BB = `0x${"bb".repeat(32)}`;

export const CASES: readonly SpellingCase[] = [
  {
    name: "an account of each kind in one call",
    old:
      "function main(program: Address, user: Address, amount: Uint256) {\n" +
      "  svm.call(Solana.account(program), [\n" +
      '    Solana.pda(program, ["state", user]).writable(),\n' +
      "    USDC.accountOf(ctx.self()).writable(),\n" +
      "    Solana.systemProgram,\n" +
      "  ], amount.toBytesLe(8));\n" +
      "}\n",
  },
  {
    name: "two keys written out, numbered in order",
    old:
      `function main(): Uint256 {\n  return Solana.account(${AA}).dataLen + ` +
      `Solana.account(${BB}).dataLen;\n}\n`,
  },
  {
    name: "the owner's token account and a mint",
    old: "function main(): Uint256 {\n  return PYUSD.accountOf(Solana.owner).dataLen + PYUSD.mint.dataLen;\n}\n",
  },
  {
    name: "every kind of seed, and a program account as the program",
    old:
      "function main(user: Address, index: Uint256): Uint256 {\n" +
      "  const vault = Solana.pda(Solana.associatedTokenProgram, [\n" +
      '    "vault-state", user, pot, Solana.owner, ctx.self(), USDC, USDC.mint,\n' +
      `    Solana.tokenProgram, index.toBytesLe(8), (7).toBytesLe(2), ${AA}, hex\`0102\`,\n` +
      "  ]);\n" +
      "  return vault.dataLen;\n}\n",
  },
  {
    name: "an address named for its constant, else its first string seed, else its place",
    old:
      "function main(to: Address, program: Address): Uint256 {\n" +
      "  const dest = Solana.pda(Solana.associatedTokenProgram, [to, Solana.tokenProgram, USDC]).writable();\n" +
      '  return dest.dataLen + Solana.pda(program, [to, "fee-vault"]).dataLen + Solana.pda(program, [to]).dataLen;\n' +
      "}\n",
  },
  {
    name: "the Pot's owner, with roles chained on it",
    old:
      "function main(): Uint256 {\n" +
      "  const signer = Solana.owner.signer();\n" +
      "  return Solana.owner.writable().dataLen + signer.dataLen;\n" +
      "}\n",
  },
  {
    name: "a Token-2022 mint's program, and the owner's and the Pot's accounts",
    old:
      "function main(): Uint256 {\n" +
      "  return PYUSD.tokenProgram.dataLen + PYUSD.accountOf(Solana.owner).dataLen +\n" +
      "    PYUSD.accountOf(pot).dataLen;\n}\n",
  },
  {
    name: "each program account, by name",
    old:
      "function main(): Uint256 {\n" +
      "  return Solana.systemProgram.dataLen + Solana.tokenProgram.dataLen +\n" +
      "    Solana.token2022Program.dataLen + Solana.associatedTokenProgram.dataLen +\n" +
      "    Solana.memoProgram.dataLen;\n}\n",
  },
  {
    name: "the wrap program: the owner's SOL into the Pot's WSOL account",
    old:
      "function main(lamports: Uint256): Uint256 {\n" +
      "  const potWsol = WSOL.accountOf(pot).writable();\n" +
      "  let transfer = hex`02000000`;\n" +
      "  svm.call(\n" +
      "    Solana.systemProgram,\n" +
      "    [Solana.owner.writable().signer(), potWsol],\n" +
      "    transfer.concat(lamports.toBytesLe(8)),\n" +
      "  );\n" +
      "  svm.call(Solana.tokenProgram, [potWsol], hex`11`);\n" +
      "  return pot.WSOL;\n}\n",
  },
  {
    name: "balances held by the owner, lamports and a token",
    old: "function main(): Uint256 {\n  return Solana.owner.USDC + pot.USDC + Solana.owner.balance;\n}\n",
  },
  {
    name: "accounts a helper takes from main, and the owner's lamports in a helper",
    old:
      "function both(): Uint256 {\n  return Solana.owner.balance + Solana.systemProgram.dataLen;\n}\n" +
      "function lamports(extra: Uint256): Uint256 {\n  return Solana.owner.balance + extra;\n}\n" +
      "function main(): Uint256 {\n  return both() + lamports(1) + pot.balance;\n}\n",
  },
  {
    name: "an account's lamports, by its key",
    old:
      "function main(to: Address): Uint256 {\n" +
      "  return (Solana.pda(Solana.systemProgram, [to])).balance + Solana.systemProgram.balance +\n" +
      "    Solana.account(to).balance;\n}\n",
  },
  {
    name: "a script, which runs as a main of its own",
    old: "svm.call(Solana.systemProgram, [Solana.owner.writable().signer(), pot.writable()], hex`02000000`.concat(hex`0100000000000000`));\n",
  },
  {
    name: "a local declared Account, and accounts passed to a helper that takes one",
    old:
      "function size(account: Account): Uint256 {\n  return account.dataLen;\n}\n" +
      "function main(key: Address): Uint256 {\n" +
      "  const signer: Account = Solana.owner.signer();\n" +
      "  return size(signer) + size(Solana.memoProgram) + size(Solana.account(key)) +\n" +
      `    size(Solana.pda(Solana.systemProgram, [Solana.owner, ${BB}]));\n}\n`,
  },
  {
    name: "the owner's account fields",
    old: "function main(): Uint256 {\n  return Solana.owner.owner + Solana.owner.address + Solana.owner.dataLen;\n}\n",
  },
  {
    name: "a record that holds the owner's account",
    old: "function main(): Uint256 {\n  const r = { holder: Solana.owner };\n  return r.holder.dataLen;\n}\n",
  },
  {
    name: "accounts passed to @sauce/token's functions",
    old:
      "function main(): Uint256 {\n" +
      "  return ownerOf(USDC, USDC.accountOf(Solana.owner)) +\n" +
      "    balanceOf(USDC, USDC.accountOf(Solana.owner).writable());\n}\n",
  },
  {
    name: "roles chained in either order",
    old: "function main(): Uint256 {\n  return Solana.owner.signer().writable().dataLen + Solana.tokenProgram.writable().dataLen;\n}\n",
  },
  {
    name: "the owner's key and an account's program, compared",
    old:
      "function main(to: Address) {\n" +
      '  require(Solana.owner.address != to, "to is the owner");\n' +
      '  require(Solana.account(to).owner == Solana.systemProgram.address, "not a wallet");\n}\n',
  },
  {
    name: "the Memo program, in a call the owner signs",
    old: 'function main() {\n  svm.call(Solana.memoProgram, [Solana.owner.signer()], "hi");\n}\n',
  },
];

/** The retired spellings, each read once, with what refuses it. */
export const RETIRED: readonly RetiredSpelling[] = [
  {
    spelling: "Solana.pda(program, [seeds])",
    read: 'Solana.pda(program, ["a"]).dataLen',
    refusal: "`Solana.pda(…)`: an account is `Account`'s: write `Account.pda(program, [seeds])`",
  },
  {
    spelling: "Solana.account(key)",
    read: "Solana.account(key).dataLen",
    refusal: "`Solana.account(…)`: write `Account(key)`",
  },
  {
    spelling: "Solana.owner",
    read: "Solana.owner.dataLen",
    refusal:
      "`Solana.owner`: the Pot's owner is `owner` (`owner.address`, its key; `owner.signer()`)",
  },
  ...[
    "systemProgram",
    "tokenProgram",
    "token2022Program",
    "associatedTokenProgram",
    "memoProgram",
  ].map((program): RetiredSpelling => ({
    spelling: `Solana.${program}`,
    read: `Solana.${program}.dataLen`,
    refusal: `\`Solana.${program}\`: write \`Account.${program}\``,
  })),
];

/**
 * A program in the retired spelling, written the new way: `Solana.pda`, `Solana.account`, the five
 * program accounts and `Solana.owner` as `Account.pda`, `Account(…)`, `Account.<program>` and
 * `owner`.
 */
export function migrated(old: string): string {
  return old
    .replace(/\bSolana\.account\(/g, "Account(")
    .replace(
      /\bSolana\.(pda|systemProgram|tokenProgram|token2022Program|associatedTokenProgram|memoProgram)\b/g,
      "Account.$1",
    )
    .replace(/\bSolana\.owner\b/g, "owner");
}
