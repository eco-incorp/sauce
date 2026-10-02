// Compiles cross-chain-cascade.sauce.ts — three hops whose amounts are each measured on arrival —
// for Ethereum, where a wallet publishes its first hop: Base, then Ethereum, then Base again. Its
// `main` arguments are fixed into the intents, as `sauce intent publish --args` fixes them.
//
// Offline: the recipient, the amounts, the creator and the fee are fixtures and nothing is sent. The
// Portals, the provers, the destination Pots and the routes' native amounts come from the SDK; the
// execution fee does not, because it is mutable on-chain and lives on each destination — read it
// with `destinationExecutionFee()`, sent as an `eth_call` to that chain. One fee pays the cook of
// every body that is a program: here Base's (the first hop) and Ethereum's (the second).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { destinationExecutionFee, routes } from "@eco-incorp/sauce";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-cascade.sauce.ts"),
  "utf8",
);

const recipient = "0x6666666666666666666666666666666666666666";
const executionFee = 1_000n; // Fixture: the Kitchens' fee, for the two bodies that are programs.

const compiled = routes.compileSauceProgram("ethereum", source, {
  args: [recipient, 1_000_000n, 1_010_000n],
  intents: {
    deadline: 2_000_000_000n,
    rewardDeadline: 2_000_003_600n,
    creator: "0x4444444444444444444444444444444444444444",
    executionFee,
  },
});
const [first] = compiled.intents;
if (first === undefined || compiled.intents.length !== 1 || first.captures.length > 0) {
  throw new Error("Expected the cascade to open one intent to Base, fixed when it is built");
}

console.log(`Cascade program: ${compiled.bytecode.length} bytes`);
console.log(`Fees are read from each chain's Kitchen, ${destinationExecutionFee().to}`);
console.log(routes.hashIntent(first.intent).intentHash);
