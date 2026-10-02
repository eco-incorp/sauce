// Compiles solana.sauce.ts the way `sauce compile --chain solana` does and checks what the
// sauce-solana skill says about it: the manifest lists the Account parameters in order with their
// roles, the mint is a module constant a define replaces, only the scalar parameters are
// arguments, execution needs an rpcUrl the caller supplies, the USDC mint's hex is the skill's, the
// Pot is the Kitchen's address for its seeds, and a cook's size is what the skill budgets. Then
// token-2022.sauce.ts: its accounts, PYUSD's token program, the two programs the skill names, and
// that moving a Token-2022 token and measuring what arrived is past one transaction. Offline:
// nothing is sent.
//
//   node solana.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "@eco-incorp/sauce/deployments";
import {
  POT_SEED,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  buildCookInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  createSauceSvmClient,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  getTransactionSize,
} from "@eco-incorp/sauce/svm";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  AccountRole,
  TRANSACTION_SIZE_LIMIT,
  address,
  blockhash,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// A public key is a 32-byte scalar: decode the SDK's base58 USDC mint into the define's value.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const usdcMint = [...USDC_MINT].reduce((n, c) => n * 58n + BigInt(BASE58.indexOf(c)), 0n);

const source = readFileSync(new URL("./solana.sauce.ts", import.meta.url), "utf8");
const program = routes.compileSauceProgram("solana", source, { defines: { MINT: usdcMint } });

// The manifest: every Account parameter, in order, with its declared role.
const slots = (program.manifest?.accounts ?? []).map((a) =>
  a.kind === "slot" ? `${a.name}:${a.requires}` : "remaining",
);
check(
  slots.join() ===
    "tokenProgram:readonly,source:writable,destination:writable,authority:readonly_signer",
  "manifest order and roles",
);
// Accounts are attached by name (`--account`), not encoded: the one argument is `amount`.
check(
  program.entryParams.map((param) => `${param.name}: ${param.type}`).join() === "amount: Uint256",
  "the arguments are the scalar parameters",
);
const args = routes.encodeEntryArguments(program, [5_000_000n]);
check(routes.decodeEntryArguments(program, args)[0] === 5_000_000n, "arguments round trip");

// Execution goes through the Kitchen client, which has no default endpoint.
let message = "";
try {
  await createSauceSvmClient({} as Parameters<typeof createSauceSvmClient>[0]);
} catch (error) {
  message = (error as Error).message;
}
check(message.includes("rpcUrl"), "createSauceSvmClient requires rpcUrl");

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
// The mint is a module constant: without the define it is 0 and the program refuses to run, with
// it the value is folded in. The skill quotes the USDC mint's 32-byte hex.
const unset = routes.compileSauceProgram("solana", source);
check(Buffer.compare(unset.bytecode, program.bytecode) !== 0, "a define replaces MINT");
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
// The skill gives the Kitchen and engine program ids, and the Kitchen's 32-byte hex for the define.
const kitchenHex = `0x${Buffer.from(getAddressEncoder().encode(kitchen)).toString("hex")}`;
for (const value of [v12SvmKitchenProgramId(), v12SvmEngineProgramId(), kitchenHex])
  check(skill.includes(value), `the skill quotes ${value}`);

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
      getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
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
check(four === 538, `with four accounts the cook adds 538 bytes, not ${four}`);
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

console.log(
  `SVM program ${program.bytecode.length} bytes, ${slots.length} account slots, ${args.length}-byte arguments`,
);
console.log(`Token-2022 program ${checked.bytecode.length} bytes`);
console.log(`released engine ${v12SvmEngineProgramId()}, Kitchen ${v12SvmKitchenProgramId()}`);
