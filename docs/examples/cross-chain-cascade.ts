// Compiles cross-chain-cascade.sauce.ts — three hops, each paying the next what it was delivered —
// for Ethereum, where `sauce intent publish` cooks it on your Pot to publish its first hop: Base,
// then Ethereum, then Base again. `main`'s arguments are the cook's, read as it runs.
//
// Offline: the fee is a fixture, and nothing is sent, so no intent is published: each one is
// encoded as the program runs and read from the Portal's `IntentPublished` log
// (`routes.intentFromPublished`), and this prints the program and the body it compiled for each
// hop. The Portals, the provers, the destination Pots and the routes' native amounts come from the
// SDK; the execution fee does not, because it is mutable on-chain and lives on each destination —
// read it with `destinationExecutionFee()`, sent as an `eth_call` to that chain. Each body pays its
// own chain's.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { destinationExecutionFee, routes } from "@eco-incorp/sauce";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-cascade.sauce.ts"),
  "utf8",
);

// Fixtures: each Kitchen's fee, for each hop's body.
const fees: Record<string, bigint> = { base: 1_000n, ethereum: 2_000n };

const compiled = routes.compileSauceProgram("ethereum", source, {
  intents: {
    // When the first hop opens, which its default deadlines count from: `sauce` uses the moment it
    // builds it. Each later hop opens when the body above it runs.
    openedAt: 2_000_000_000n,
    executionFee: (destination) => fees[destination.slug],
  },
});
const hops = compiled.bodies.map((body) => body.destination.slug).sort();
if (hops.join() !== "base,base,ethereum") {
  throw new Error(`Expected a body on Base, on Ethereum and on Base again, not ${hops}`);
}

console.log(
  `Cascade program: ${compiled.bytecode.length} bytes, main(${compiled.entryParams.map((param) => param.name).join(", ")})`,
);
for (const body of compiled.bodies) {
  console.log(`  a body for ${body.destination.slug}: ${body.bytecode.length} bytes`);
}
console.log(`Fees are read from each chain's Kitchen, ${destinationExecutionFee().to}`);
