// Compiles cross-chain-cascade.sauce.ts — three hops whose amounts are each measured on arrival — as
// the body of an Ethereum -> Base intent: Base, then Ethereum, then Base again.
//
// Offline: the creator and the fees are fixtures and nothing is sent. The Portals, the provers, the
// destination Pots and the route's native amount come from the SDK; the execution fees do not,
// because they are mutable on-chain and live on each destination — read each with
// `destinationExecutionFee()`, sent as an `eth_call` to that chain.
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
const baseFee = 1_000n; // Fixture: Base's Kitchen fee, for this intent's own body.
const ethereumFee = 2_000n; // Fixture: Ethereum's, for the middle hop's body, which is a program.

const options: routes.IntentOptions = {
  execution: { value: baseFee },
  deadline: 2_000_000_000n,
  creator,
  source: "ethereum",
  defines: { RECIPIENT: BigInt("0x6666666666666666666666666666666666666666") },
  // The intents the body opens inherit the deadline and the creator. A program body among them
  // cooks, so it needs its destination Kitchen's fee: one fee for every such body.
  compile: { intents: { executionFee: ethereumFee } },
};

const built = Base(program, options).reward({ deadline: 2_000_003_600n });

console.log(`Cascade program: ${built.compiled.bytecode[0]!.length} bytes`);
console.log(`Fees are read from each chain's Kitchen, ${destinationExecutionFee().to}`);
console.log(built.hash().intentHash);
