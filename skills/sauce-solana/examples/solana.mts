// Compiles solana.sauce.ts the way `sauce compile --chain solana` does and checks what the
// sauce-solana skill says about it: the manifest lists the Account parameters in order with their
// roles, the mint and the amount are main's arguments after the accounts, only the scalar
// parameters are arguments, execution needs an rpcUrl the caller supplies, the USDC mint's hex is the skill's, the
// Pot is the Kitchen's address for its seeds, the skill sends the reader to sauce-chains' deployments
// file for the Kitchen and engine, a cook's size is what the skill budgets, and the first-run rent
// figures are the SDK's (the Pot's size, rent per byte). Then
// token-2022.sauce.ts: its accounts, PYUSD's token program, the two programs the skill names, and
// that moving a Token-2022 token and measuring what arrived is past one transaction. Then
// pay.sauce.ts: the accounts the token methods add to main and how each is derived, the checks
// after each write, the same file on Base, and a derivation resolved to the account it names. Then
// wrap.sauce.ts and the accounts written where they are used: each one's derivation and role, the
// names the skill gives, one slot for an account written twice, the check each is held to and its
// reason, and the refusal of a seed computed as the program runs.
// Offline: nothing is sent.
//
//   node solana.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";
import { requireChain } from "@eco-incorp/sauce/chains";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "@eco-incorp/sauce/deployments";
import {
  AccountRole,
  MAX_POT_LEN,
  POT_SEED,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TRANSACTION_SIZE_LIMIT,
  USDC_MINT,
  address,
  blockhash,
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  createSauceSvmClient,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionSize,
  resolveSvmAccountName,
  svmRentExempt,
} from "@eco-incorp/sauce/svm";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// A public key is a 32-byte scalar: decode the SDK's base58 USDC mint into the word it is.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const usdcMint = [...USDC_MINT].reduce((n, c) => n * 58n + BigInt(BASE58.indexOf(c)), 0n);

const source = readFileSync(new URL("./solana.sauce.ts", import.meta.url), "utf8");
const program = routes.compileSauceProgram("solana", source);

// The manifest: every Account parameter, in order, with its declared role.
const slots = (program.manifest?.accounts ?? []).map((a) =>
  a.kind === "slot" ? `${a.name}:${a.requires}` : "remaining",
);
check(
  slots.join() ===
    "tokenProgram:readonly,source:writable,destination:writable,authority:readonly_signer",
  "manifest order and roles",
);
// Accounts are attached by name (`--account`), not encoded: the arguments are the mint and the
// amount. On Solana a public key is one ABI word, the 32-byte integer it is, as `--args` encodes a
// base58 key.
check(
  program.entryParams.map((param) => `${param.name}: ${param.type}`).join() ===
    "mint: Address,amount: Uint256",
  "the arguments are the scalar parameters",
);
const words = {
  ...program,
  entryParams: program.entryParams.map((param) => ({ ...param, type: "Uint256" })),
};
const args = routes.encodeEntryArguments(words, [usdcMint, 5_000_000n]);
const decoded = routes.decodeEntryArguments(words, args);
check(decoded[0] === usdcMint && decoded[1] === 5_000_000n, "arguments round trip");

// Execution goes through the Kitchen client, which has no default endpoint.
let message = "";
try {
  await createSauceSvmClient({} as Parameters<typeof createSauceSvmClient>[0]);
} catch (error) {
  message = (error as Error).message;
}
check(message.includes("rpcUrl"), "createSauceSvmClient requires rpcUrl");

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
// The skill quotes the USDC mint's 32-byte hex.
const mintHex = `0x${usdcMint.toString(16).padStart(64, "0")}`;
check(skill.includes(USDC_MINT) && skill.includes(mintHex), `the skill quotes ${mintHex}`);

// The Pot is the Kitchen's program address for ["pot", owner, salt], the seeds the skill gives.
const kitchen = address(v12SvmKitchenProgramId());
const owner = await generateKeyPairSigner();
const salt = new Uint8Array(32);
const pot = await derivePotPda(kitchen, owner.address, salt);
const [byHand] = await getProgramDerivedAddress({
  programAddress: kitchen,
  seeds: ["pot", getAddressEncoder().encode(owner.address), salt],
});
check(POT_SEED === "pot" && pot.address === byHand, "the Pot's seeds are pot, owner, salt");
// The skill sends the reader to sauce-chains' deployments file for the Kitchen and engine program
// ids and the Kitchen's 32-byte hex, under these keys (sauce-chains' runner holds the file to the
// released programs).
check(
  skill.includes("(../sauce-chains/references/deployments.json)"),
  "the skill links the deployments file",
);
for (const key of ["svm.kitchen.programId", "svm.kitchen.key", "svm.engine", "svm.kitchen"])
  check(skill.includes(`\`${key}\``), `the skill names ${key} in the deployments file`);

// The first-run costs: rent is (bytes + 128) × 6,960 lamports, the SDK's own rent-exempt figure,
// and the Pot is the Kitchen's largest, the size every Pot is created with.
const lamports = (value: bigint): string => value.toLocaleString("en-US");
check(svmRentExempt(0) === 128n * 6_960n, "rent is (bytes + 128) × 6,960");
check(skill.includes("`(data bytes + 128) × 6,960` lamports"), "the skill gives the rent formula");
check(MAX_POT_LEN === 10_240, "a Pot is 10,240 bytes");
for (const [what, bytes] of [
  ["the Pot, 10,240 bytes", MAX_POT_LEN],
  ["a token account, 165 bytes", 165],
  ["a code buffer, 91 bytes", 91],
  ["a lookup table, 56 bytes", 56],
] as const) {
  const row = skill.split("\n").find((line) => line.startsWith(`| ${what}`)) ?? "";
  check(row.includes(lamports(svmRentExempt(bytes))), `${what}: ${lamports(svmRentExempt(bytes))}`);
}
check(
  skill.includes(`${lamports(svmRentExempt(32) - svmRentExempt(0))} for each address`),
  "a lookup-table entry's rent",
);

// A cook as `sauce run` builds it: the heap frame, a compute-unit limit, the Kitchen's cook.
async function cookSize(accounts: number): Promise<number> {
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const tail = await Promise.all(
    Array.from({ length: accounts }, async () => ({
      address: (await generateKeyPairSigner()).address,
      role: AccountRole.WRITABLE,
    })),
  );
  const transaction = await buildExecuteTransaction({
    payer: owner,
    instructions: [
      buildHeapFramePrepend(),
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildCookInstruction({
        kitchen,
        owner: owner.address,
        engineProgram: address(v12SvmEngineProgramId()),
        potSalt: salt,
        pot: pot.address,
        feeConfig,
        bytecode: new Uint8Array([...program.bytecode, ...args]),
        maxExecutionFee: 1_000_000n,
        tail,
      }),
    ],
    latestBlockhash: {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 0n,
    },
  });
  return getTransactionSize(transaction) - program.bytecode.length - args.length;
}
check(TRANSACTION_SIZE_LIMIT === 1232, "a Solana transaction is at most 1,232 bytes");
const four = await cookSize(4);
const five = await cookSize(5);
console.log(`cook overhead with four attached accounts: ${four} bytes`);
check(five - four === 33, `an account costs 33 bytes, not ${five - four}`);

// The Token-2022 example: PYUSD is a registered symbol, its row names Token-2022, and the program
// takes the mint as an account between the source and the destination.
const checked = routes.compileSauceProgram(
  "solana",
  readFileSync(new URL("./token-2022.sauce.ts", import.meta.url), "utf8"),
);
check(
  (checked.manifest?.accounts ?? [])
    .map((a) => (a.kind === "slot" ? `${a.name}:${a.requires}` : "remaining"))
    .join() ===
    "tokenProgram:readonly,source:writable,mint:readonly,destination:writable,pot:readonly_signer",
  "the Token-2022 example's manifest order and roles",
);
const pyusd = routes.SVM_TOKEN_REGISTRY["mainnet-beta"].find((row) => row.symbol === "PYUSD");
check(pyusd?.tokenProgram === TOKEN_2022_PROGRAM_ID, "PYUSD is a Token-2022 mint");
for (const id of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])
  check(skill.includes(id), `the skill names the token program ${id}`);
// Its cook, with five accounts and its argument, does not fit one transaction: `sauce run` stages it.
const fiveAccounts = await cookSize(5);
check(
  checked.bytecode.length + 32 + fiveAccounts > TRANSACTION_SIZE_LIMIT,
  "a Token-2022 transfer that measures what arrived is past one transaction",
);

// The token methods: pay.sauce.ts names no account. Compiling adds each one its call moves through
// to main, after main's own parameters, with how it is derived, as the skill's table says.
const pay = routes.compileSauceProgram(
  "solana",
  readFileSync(new URL("./pay.sauce.ts", import.meta.url), "utf8"),
);
check(
  JSON.stringify(pay.derivedAccounts) ===
    JSON.stringify({
      potUSDC: "pot:USDC",
      pot: "pot",
      tokenProgram: TOKEN_PROGRAM_ID,
      toUSDC: "@to:USDC",
    }),
  `pay.sauce.ts's added accounts and their derivations, not ${JSON.stringify(pay.derivedAccounts)}`,
);
for (const [slot, derive] of Object.entries(pay.derivedAccounts ?? {}))
  check(
    skill.includes(`\`${slot}\``) && skill.includes(`\`${derive}\``),
    `the skill's table has ${slot}`,
  );
check(
  pay.entryParams.map((param) => param.name).join() === "to,amount",
  "the added accounts are no arguments: main's are to and amount",
);
// Each holder's account is checked after the write, with the reason the skill names.
for (const reason of ["wrong recipient account", "wrong holder account"]) {
  check(pay.source.includes(reason), `the lowering checks with "${reason}"`);
  check(skill.includes(`\`${reason}\``), `the skill names "${reason}"`);
}
// The same file compiles for Base, where the methods are SafeERC20 and add no account.
const onBase = routes.compileSauceProgram(
  "base",
  readFileSync(new URL("./pay.sauce.ts", import.meta.url), "utf8"),
);
check(
  onBase.manifest === undefined && onBase.derivedAccounts === undefined,
  "Base adds no account",
);
// The command derives each from the cook: `@to:USDC` is the associated USDC account of main's
// argument `to`, `pot:USDC` the Pot's, `pot` the Pot itself.
const recipient = (await generateKeyPairSigner()).address;
const named = { chain: requireChain("solana"), owner: owner.address, pot: pot.address };
const toUsdc = await resolveSvmAccountName("@to:USDC", { ...named, args: { to: recipient } });
const [ata] = await getProgramDerivedAddress({
  programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  seeds: [
    getAddressEncoder().encode(recipient),
    getAddressEncoder().encode(TOKEN_PROGRAM_ID),
    getAddressEncoder().encode(USDC_MINT),
  ],
});
check(toUsdc.value === ata, "@to:USDC is the recipient's associated USDC account");
check(
  (await resolveSvmAccountName("authority", named)).value === "pot",
  "authority is the Pot through the Kitchen",
);
// A Token-2022 mint takes the checked write and its mint as one more account.
const stock = routes.compileSauceProgram(
  "solana",
  "function main(to: Address, amount: Uint256) {\n  PYUSD.transfer(to, amount);\n}\n",
);
check(stock.source.includes("transferChecked"), "a Token-2022 mint moves by transferChecked");
check(stock.derivedAccounts?.mintPYUSD === "mint:PYUSD", "and takes its mint as an account");

// Accounts where they are used: wrap.sauce.ts writes each account in its calls. Compiling adds each
// to main with its derivation and the role its uses give it, as the skill's section says, and the
// Pot, whose key the Pot's WSOL account is checked to be held by.
const wrap = routes.compileSauceProgram(
  "solana",
  readFileSync(new URL("./wrap.sauce.ts", import.meta.url), "utf8"),
);
const wrapRoles = Object.fromEntries(
  (wrap.manifest?.accounts ?? []).flatMap((a) => (a.kind === "slot" ? [[a.name, a.requires]] : [])),
);
check(
  JSON.stringify(wrap.derivedAccounts) ===
    JSON.stringify({
      potWSOL: "pot:WSOL",
      pot: "pot",
      systemProgram: "11111111111111111111111111111111",
      owner: "owner",
      tokenProgram: TOKEN_PROGRAM_ID,
    }) &&
    JSON.stringify(wrapRoles) ===
      JSON.stringify({
        potWSOL: "writable",
        pot: "readonly_signer",
        systemProgram: "readonly",
        owner: "writable_signer",
        tokenProgram: "readonly",
      }),
  `wrap.sauce.ts's accounts, derivations and roles, not ${JSON.stringify(wrap.derivedAccounts)} ${JSON.stringify(wrapRoles)}`,
);
check(
  wrap.entryParams.map((param) => param.name).join() === "lamports",
  "wrap.sauce.ts's only argument is lamports",
);
// The skill's table: each expression's derivation, a pda named for its constant or first string
// seed, and one slot however often an account is written.
const table = routes.compileSauceProgram(
  "solana",
  "function main(program: Address, to: Address): Uint256 {\n" +
    "  const dest = Account.pda(program, [to]).writable();\n" +
    '  return dest.dataLen + Account.pda(program, ["state", to]).dataLen + Account(program).dataLen +\n' +
    "    pot.dataLen + pot.owner.dataLen + Account.token2022Program.dataLen +\n" +
    "    Account.associatedTokenProgram.dataLen + Account.memoProgram.dataLen + USDC.mint.dataLen +\n" +
    "    USDC.tokenProgram.dataLen + USDC.accountOf(to).dataLen + USDC.accountOf(to).dataLen;\n}\n",
);
const derived = table.derivedAccounts ?? {};
check(derived.destPda === "pda:@program:@to", "a pda is named for the constant it initializes");
check(derived.statePda === 'pda:@program:"state",@to', "else for its first string seed");
check(
  derived.programAccount === "@program" && derived.pot === "pot" && derived.owner === "owner",
  "Account(key), pot and pot.owner",
);
check(
  derived.mintUSDC === "mint:USDC" && derived.toUSDC === "@to:USDC",
  "USDC.mint and USDC.accountOf(to), written twice, one slot",
);
check(
  Object.keys(derived).filter((name) => derived[name] === "@to:USDC").length === 1,
  "one slot for an account written twice",
);
check(
  skill.includes("| `pda:<program>:<seeds>`") && skill.includes("`destPda`"),
  "the skill's table",
);
// Each account is checked on chain, with the reason the skill names: the checks open main.
for (const reason of [
  "wrong account",
  "wrong program-derived address",
  "wrong holder account",
  "wrong mint",
  "wrong program",
]) {
  check(table.source.includes(`"${reason}");`), `the lowering checks with "${reason}"`);
  check(skill.includes(`\`${reason}\``), `the skill names "${reason}"`);
}
check(
  table.source.includes("crypto.findPDA(program, [to.toBytesBe(32)])"),
  "the engine derives a program-derived address again",
);
// A seed computed as the program runs is refused, naming the Account parameter.
let refused = "";
try {
  routes.compileSauceProgram(
    "solana",
    'function main(program: Address): Uint256 {\n  const x = 5;\n  return Account.pda(program, ["a", x]).dataLen;\n}\n',
  );
} catch (error) {
  refused = (error as Error).message;
}
check(
  refused.includes("must be known when the transaction is built") &&
    refused.includes("`Account` parameter of main"),
  `a seed computed as the program runs is refused: ${refused}`,
);
// Accounts are `Account`'s and the owner is `pot.owner`: the chain's name holds none, and an
// account spelled on it is refused, naming what to write.
for (const [spelled, instead] of [
  ["Solana.pda(program, [to]).dataLen", "Account.pda(program, [seeds])"],
  ["Solana.account(program).dataLen", "Account(key)"],
  ["Solana.owner.dataLen", "pot.owner"],
  ["Solana.systemProgram.dataLen", "Account.systemProgram"],
]) {
  let retired = "";
  try {
    routes.compileSauceProgram(
      "solana",
      `function main(program: Address, to: Address): Uint256 {\n  return ${spelled};\n}\n`,
    );
  } catch (error) {
    retired = (error as Error).message;
  }
  check(retired.includes(`\`${instead}\``), `${spelled} is refused naming ${instead}: ${retired}`);
}

console.log(
  `SVM program ${program.bytecode.length} bytes, ${slots.length} account slots, ${args.length}-byte arguments`,
);
console.log(
  `token-method program ${pay.bytecode.length} bytes, ${Object.keys(pay.derivedAccounts ?? {}).length} accounts derived`,
);
console.log(`Token-2022 program ${checked.bytecode.length} bytes`);
console.log(`released engine ${v12SvmEngineProgramId()}, Kitchen ${v12SvmKitchenProgramId()}`);
