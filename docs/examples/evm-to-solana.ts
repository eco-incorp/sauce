// Compiles evm-to-solana.sauce.ts for Ethereum, with a Solana wallet as `main`'s first argument,
// and builds what an Ethereum wallet sends to publish it: the reward paid into the intent's vault,
// then Portal.publish. What `sauce intent publish evm-to-solana.sauce.ts --chain ethereum --args …`
// sends.
//
// Offline: the wallet, the creator and the deadline are fixtures, and nothing is read or sent. The
// `sauce` command reads Solana first (`intents.svm`): which token accounts exist, so the route
// creates only what is missing. With nothing read, the route creates the wallet's USDC account,
// idempotently, which costs the solver its rent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@eco-incorp/sauce";
import { ecoRoutesPortal } from "@eco-incorp/sauce/protocols/eco-routes";
import { svmKeyOf } from "@eco-incorp/sauce/svm";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "evm-to-solana.sauce.ts"),
  "utf8",
);

// Offline fixtures: the Solana wallet paid, and who may reclaim the reward if no solver earns it.
const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const creator = "0x4444444444444444444444444444444444444444";

// main(recipient, amount, reward): 1 USDC to the wallet, for 1.05 USDC on Ethereum.
const [opened] = routes.compileSauceProgram("ethereum", source, {
  args: [wallet, 1_000_000n, 1_050_000n],
  intents: { deadline: 2_000_000_000n, creator },
}).intents;
if (opened === undefined || opened.destination.slug !== "solana") {
  throw new Error("the file opens no intent to Solana");
}
const { route } = opened.intent;

// The route runs on Solana: each call a Solana program, its Portal Solana's.
console.log("Intent to Solana:", routes.hashIntent(opened.intent).intentHash);
console.log("Solana's Portal:", svmKeyOf(route.portal));
console.log(
  "Route calls:",
  route.calls.map((call) => svmKeyOf(call.target)),
);
console.log(
  "The solver delivers:",
  route.tokens.map((token) => `${token.amount} of ${svmKeyOf(token.token)}`),
);
console.log("and lamports for the account it creates:", route.nativeAmount);
if (route.calls.length !== 2 || route.nativeAmount === 0n) {
  throw new Error("expected the wallet's account created, then paid");
}

// Published from an Ethereum wallet: the reward into its vault, then publish.
const transactions = routes.intentSourceTxs(opened.intent, {
  portal: ecoRoutesPortal("ethereum"),
});
console.log(`Published by ${transactions.length} transactions on Ethereum`);
