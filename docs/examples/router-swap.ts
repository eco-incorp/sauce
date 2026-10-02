// Compiles router-swap.sauce.ts — a program that swaps through @sauce/router, choosing its amounts
// as it runs — for Ethereum, and appends its floor as `main`'s argument: the program a Pot cooks.
//
// The SauceScript is its own file so it is the same text the router reference shows. Everything
// here is offline: nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@eco-incorp/sauce";
import { bytesToHex, concatHex } from "viem";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "router-swap.sauce.ts"),
  "utf8",
);

// The SDK serves @sauce/router — and the @sauce/token and pool ABIs it imports — from memory, so
// compiling needs no resolver option, and it resolves the registry's names for Ethereum.
export const program = routes.compileSauceProgram("ethereum", source);

// main(minOut): keep at least 2,500 USDT (6 decimals), encoded as `--args` encodes it and appended
// to the bytecode. One compile serves every floor.
export const minOut = 2_500n * 10n ** 6n;
export const payload = concatHex([
  bytesToHex(program.bytecode),
  bytesToHex(routes.encodeEntryArguments(program, [minOut])),
]);

console.log(`@sauce/router swap: ${program.bytecode.length} bytes, plus its floor`);
console.log(payload.slice(0, 18));
