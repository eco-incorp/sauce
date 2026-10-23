// Compiles solana-swap.sauce.ts — one swap at an Orca whirlpool, the pool found by its key and the
// amounts given as `main`'s arguments — for Solana, and lists the accounts compiling added to
// `main`: each with how a cook derives it, from the pool, the Pot and the arguments, so no one names
// an account by hand.
//
// The SauceScript is its own file so it is the same text the Solana guide shows. Everything here is
// offline: nothing is read from a cluster and nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@eco-incorp/sauce";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "solana-swap.sauce.ts"),
  "utf8",
);

export const program = routes.compileSauceProgram("solana", source);

// `slot:Orca.Whirlpool(USDC,WSOL,4):USDC.vaultA` is one of the pool's nine accounts paying USDC,
// read from the pool its key finds; `authority:USDC` the Pot's USDC account; `@to:WSOL` the WSOL
// account of main's argument `to`.
export const derived = program.derivedAccounts ?? {};
if (
  program.manifest?.accounts.some(
    (entry) => entry.kind === "slot" && !Object.hasOwn(derived, entry.name),
  )
) {
  throw new Error("an account of the swap is not derived");
}

console.log(`Solana swap: ${program.bytecode.length} bytes, every account derived:`);
for (const [name, derivation] of Object.entries(derived)) console.log(`  ${name} = ${derivation}`);
