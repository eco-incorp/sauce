// An Ethereum -> Base intent whose body opens a Base -> Ethereum intent when it runs, written as a
// closure; then the same intent from nested-intent.sauce.ts, the file `sauce intent publish` opens
// with its `main` arguments, which is the same bytes.
//
// Offline: the creator, the recipient, the amounts and the fee are fixtures and nothing is sent. The
// Portals, the provers, the Pot, the engine and the native amounts come from the SDK.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, destinationPot, Ethereum, routes, token } from "@eco-incorp/sauce";
import { toHex } from "viem";

const usdcOn = (chain: typeof Base.chain) => {
  const value = routes.registryTokenAddress(chain, "USDC");
  if (value === undefined) throw new Error("Missing USDC registry");
  return toHex(value, { size: 20 });
};
const baseUsdc = usdcOn(Base.chain);

const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const AMOUNT = 1_000_000n;
const REWARD = 1_010_000n;
const executionFee = 1_000n; // Fixture: Base's Kitchen fee, read with destinationExecutionFee().
const creator = "0x4444444444444444444444444444444444444444";

const built = Base(
  () => {
    // Runs on Base, in the fill of this intent: what the solver delivered, measured there.
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    // Opened, funded in Base's USDC and published on Base, in that same fill.
    Ethereum(() => {
      USDC.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: USDC, amount }] });
  },
  {
    execution: { value: executionFee },
    deadline: 2_000_000_000n,
    rewardDeadline: 2_000_003_600n,
    // Every intent the body opens takes the deadlines and the creator.
    creator,
    defines: { RECIPIENT },
    // What the solver brings to Base. It arrives at the Executor; the body measures the Pot.
    tokens: [{ token: baseUsdc, amount: AMOUNT }],
    precalls: [
      token.Token.transfer({
        token: baseUsdc,
        to: destinationPot(Base.chain),
        amount: AMOUNT,
      }).toCall(),
    ],
  },
).reward({
  source: Ethereum.chain,
  deadline: 2_000_003_600n,
  tokens: [{ token: usdcOn(Ethereum.chain), amount: REWARD }],
});
console.log("Ethereum → Base → Ethereum:", built.hash().intentHash);

// The file form, compiled for Ethereum where it opens its intent, with main's arguments fixed into
// it as `sauce intent publish --args <recipient> <delivered> <reward>` fixes them.
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "nested-intent.sauce.ts"),
  "utf8",
);
const [opened] = routes.compileSauceProgram("ethereum", source, {
  args: [toHex(RECIPIENT, { size: 20 }), AMOUNT, REWARD],
  intents: { deadline: 2_000_000_000n, rewardDeadline: 2_000_003_600n, creator, executionFee },
}).intents;
if (
  opened === undefined ||
  routes.hashIntent(opened.intent).intentHash !== built.hash().intentHash
) {
  throw new Error("Expected the file to open the intent the closure builds");
}
// Fixed when it is built, so a wallet publishes it: what `sauce intent publish` sends.
const transactions = built.sourceTxs();
console.log(`Published by ${transactions.length} transactions on Ethereum`);
