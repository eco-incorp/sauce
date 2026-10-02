// Compiles nested-intent.sauce.ts and nested-swap.sauce.ts for Ethereum, where each opens its outer
// intent, and builds the wallet transactions that fund and publish it there — what
// `sauce intent publish` sends. The inner intents are not built here: each outer body builds its
// own on Base, around the amount it measures, and publishes it there.
//
// Offline: the creator, the recipient, the pool, the amounts and the fee are fixtures and nothing is
// sent. The Portals, the provers, the Pot, the engine and the native amounts come from the SDK.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@eco-incorp/sauce";
import { ecoRoutesPortal } from "@eco-incorp/sauce/protocols/eco-routes";

const source = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");

const options = {
  defines: {
    AMOUNT: 1_000_000n,
    REWARD: 1_010_000n,
    RECIPIENT: 0x6666666666666666666666666666666666666666n,
    POOL: 0xd0b53d9277642d899df5c87a3966a349a798f224n, // Base's Uniswap V3 WETH/USDC pool
    MIN_OUT: 1n,
  },
  // Every intent the file opens, at every depth, takes these. The fee pays the outer body's cook on
  // Base; read it there with destinationExecutionFee().
  intents: {
    deadline: 2_000_000_000n,
    rewardDeadline: 2_000_003_600n,
    creator: "0x4444444444444444444444444444444444444444",
    executionFee: 1_000n,
  },
} as const;

for (const file of ["nested-intent.sauce.ts", "nested-swap.sauce.ts"]) {
  const [opened] = routes.compileSauceProgram("ethereum", source(file), options).intents;
  // Fixed when it is built — every amount is a define — so it is published from a wallet.
  if (opened === undefined || opened.captures.length > 0 || opened.destination.slug !== "base") {
    throw new Error(`Expected ${file} to open one fixed intent to Base`);
  }
  const { intent } = opened;
  // The delivery into Base's Pot, then the cook of the body; the solver sends the cook's fee.
  if (
    intent.route.calls.length !== 2 ||
    intent.route.nativeAmount !== options.intents.executionFee
  ) {
    throw new Error(`Expected ${file}'s route to deliver to the Pot and cook once`);
  }
  const transactions = routes.intentSourceTxs(intent, { portal: ecoRoutesPortal("ethereum") });
  console.log(`${file}: ${routes.hashIntent(intent).intentHash}, ${transactions.length} txs`);
}
