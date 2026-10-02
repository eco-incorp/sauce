// Compiles cross-chain-cascade.sauce.ts — three hops whose amounts are each measured on arrival.
//
// Offline: the creator and the fee are fixtures and nothing is sent. The Portals, the provers, the
// destination Pots and the route's native amount come from the SDK; the execution fee does not,
// because it is mutable on-chain and lives on the destination — read it with
// `destinationExecutionFee()`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, destinationExecutionFee } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const program = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-cascade.sauce.ts"),
  "utf8",
);

const creator = "0x4444444444444444444444444444444444444444";
const executionFee = 1_000n; // Fixture: `destinationExecutionFee()` builds the read for the real one.

const options: routes.IntentOptions = {
  execution: { value: executionFee },
  deadline: 2_000_000_000n,
  creator,
  source: "ethereum",
  defines: { RECIPIENT: BigInt("0x6666666666666666666666666666666666666666") },
  // A program body cooks, so its hop needs the destination Kitchen's fee. Everything else the
  // intents inherit from this one.
  compile: { intents: { executionFee } },
};

const built = Base(program, options).reward({ deadline: 2_000_003_600n });

console.log(`Cascade program: ${built.compiled.bytecode[0]!.length} bytes`);
console.log(`Fee is read from ${destinationExecutionFee().to}`);
console.log(built.hash().intentHash);
