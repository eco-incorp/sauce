// Compiles cross-chain-intent.sauce.ts — the program that creates an intent from inside another
// intent — and packages it as an Eco intent of its own.
//
// The SauceScript is its own file rather than a template literal so it is the same text the README
// shows and the same text you can compile yourself. Everything here is offline: the addresses and
// the fee are fixtures and nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const program = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-intent.sauce.ts"),
  "utf8",
);

// Offline fixtures. Read the destination Kitchen fee before use. The Pot and engine are derived.
const executionFee = 1_000n;
const creator = "0x4444444444444444444444444444444444444444";

const options: routes.IntentOptions = {
  execution: { value: executionFee },
  nativeAmount: executionFee,
  // No `portal`: the SDK carries the eco-routes deployments, and this intent runs on Base.
  deadline: 2_000_000_000n,
  creator,
  prover: "0x5555555555555555555555555555555555555555",
  source: "ethereum",
  // The names the program reads. A define is one 256-bit word folded into the bytecode, which is
  // how a program is parameterised — it captures nothing from the JavaScript around it.
  defines: {
    RECIPIENT: BigInt("0x6666666666666666666666666666666666666666"),
    MIN_AMOUNT: 1n,
  },
};

// The intent the program creates inherits this one's deadline, creator and eco-routes deployment,
// so there is nothing extra to configure for it.
const built = Base(program, options).reward({
  creator,
  prover: "0x5555555555555555555555555555555555555555",
  deadline: 2_000_003_600n,
  nativeAmount: 0n,
});

console.log(`Cross-chain intent program: ${built.compiled.bytecode[0]!.length} bytes`);
console.log(built.hash().intentHash);
