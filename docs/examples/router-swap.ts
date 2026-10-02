// Compiles router-swap.sauce.ts — a program that swaps through @sauce/router, choosing its amounts
// as it runs — into the call a Pot cooks, and into an Eco intent of its own.
//
// The SauceScript is its own file so it is the same text the router reference shows. Everything
// here is offline: the Pot, the engine and the fee are fixtures, and nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, routes } from "@eco-incorp/sauce";

const program = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "router-swap.sauce.ts"),
  "utf8",
);

// The SDK serves @sauce/router — and the @sauce/token and pool ABIs it imports — from memory, so
// compiling needs no resolver option. MIN_OUT is the floor on the crvUSD the program keeps.
export const defines = { MIN_OUT: 2_500n * 10n ** 18n };
export const compiled = routes.compileSauceRoute(
  "base",
  program,
  {
    pot: "0x2222222222222222222222222222222222222222",
    engine: "0x3333333333333333333333333333333333333333",
  },
  { defines },
);
if (compiled.calls.length !== 1) throw new Error("Expected one cook");

// The same program as an intent body: a solver runs it on Base for a reward on Ethereum.
const executionFee = 1_000n;
const built = Base(program, {
  execution: { value: executionFee },
  nativeAmount: executionFee,
  deadline: 2_000_000_000n,
  defines,
}).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  prover: "0x5555555555555555555555555555555555555555",
  deadline: 2_000_003_600n,
  nativeAmount: executionFee,
});

console.log(`@sauce/router swap: ${compiled.compiled.bytecode[0]!.length} bytes`);
console.log(built.hash().intentHash);
