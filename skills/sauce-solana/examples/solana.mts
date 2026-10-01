// Compiles solana.sauce.ts the way `sauce compile --chain solana` does and checks what the
// sauce-solana skill says about it: the manifest lists the Account parameters in order with their
// roles, the mint is a define, only the scalar parameters are arguments, and execution needs an
// rpcUrl the caller supplies. Offline: nothing is sent.
//
//   node solana.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "@eco-incorp/sauce/deployments";
import { USDC_MINT, createSauceSvmClient } from "@eco-incorp/sauce/svm";

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

console.log(
  `SVM program ${program.bytecode.length} bytes, ${slots.length} account slots, ${args.length}-byte arguments`,
);
console.log(`released engine ${v12SvmEngineProgramId()}, Kitchen ${v12SvmKitchenProgramId()}`);
