// Compiles cross-chain-intent.sauce.ts — the program that creates an intent from inside another
// intent — and packages it as the route call a solver executes.
//
// The SauceScript is kept in its own file rather than a template literal so it is the same text the
// README shows and the same text you can compile yourself. Everything here is offline: the
// addresses and the fee are fixtures and no transaction is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const program = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-intent.sauce.ts"),
  "utf8",
);

// Offline fixtures. Read the destination Kitchen fee and use an Executor-owned Pot before use.
const executionFee = 1_000n;
const token = "0x1111111111111111111111111111111111111111";
const portal = "0x3333333333333333333333333333333333333333";

const options: routes.IntentOptions = {
  execution: {
    pot: "0x4444444444444444444444444444444444444444",
    engine: "0x5555555555555555555555555555555555555555",
    value: executionFee,
  },
  nativeAmount: executionFee,
  portal,
  deadline: 2_000_000_000n,
  // Every capitalised name the program reads. A define is one 256-bit word, constant-folded into
  // the bytecode, so a given set of values always compiles to the same program.
  defines: {
    TOKEN: BigInt(token),
    RECIPIENT: BigInt("0x6666666666666666666666666666666666666666"),
    PORTAL: BigInt(portal),
    DESTINATION_PORTAL: BigInt(portal),
    DESTINATION: 42_161n,
    CREATOR: BigInt("0x7777777777777777777777777777777777777777"),
    PROVER: BigInt("0x8888888888888888888888888888888888888888"),
    DEADLINE: 2_000_003_600n,
    SALT: 1n,
    MIN_AMOUNT: 1n,
  },
};

const built = Base(program, options).reward({
  source: "ethereum",
  creator: "0x7777777777777777777777777777777777777777",
  prover: "0x8888888888888888888888888888888888888888",
  deadline: 2_000_003_600n,
  nativeAmount: 0n,
});

console.log(`Cross-chain intent program: ${built.compiled.bytecode[0]!.length} bytes`);
console.log(built.hash().intentHash);
