// An Ethereum -> Base intent whose body opens a Base -> Ethereum intent when it runs, written as a
// closure; then the same intent from nested-intent.sauce.ts, the file `sauce intent publish` opens
// with its `main` arguments, which is the same bytes. And nested-swap.sauce.ts, whose inner reward
// is a swap's output.
//
// Offline: the creator, the recipient, the amounts and the fee are fixtures and nothing is sent. The
// Portals, the provers, the Pot, the engine and the native amounts come from the SDK.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, Ethereum, routes } from "@eco-incorp/sauce";
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

// When the intent opens, and its salt: the `sauce` command takes them from the clock and at random,
// and fixtures here, so the closure and the file below build the same intent.
const openedAt = 2_000_000_000n;
const salt = `0x${"5a".repeat(32)}` as const;

const built = Base.Portal.send({ token: usdcOn(Ethereum.chain), amount: REWARD })
  .source("ethereum")
  .creator(creator)
  .receive({ token: baseUsdc, amount: AMOUNT })
  .fee(executionFee)
  .deadline(openedAt + routes.DEFAULT_FILL_WINDOW)
  .salt(salt)
  .then(() => {
    // Runs on Base, in the fill of this intent: what the solver delivered, measured there.
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    // Opened, funded in Base's USDC and published on Base, in that same fill: its deadlines count
    // from then. Every intent a program opens names its creator.
    Ethereum.Portal.send({ token: USDC, amount })
      .creator(0x4444444444444444444444444444444444444444n)
      .receive({ token: USDC, amount: payout })
      .salt(0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5an)
      .then(() => {
        USDC.transfer(0x6666666666666666666666666666666666666666n, payout);
      });
  });
console.log("Ethereum → Base → Ethereum:", built.hash().intentHash);

// The file form, compiled for Ethereum where it opens its intent, with main's arguments fixed into
// it as `sauce intent publish --args <recipient> <delivered> <reward>` fixes them.
const source = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
const recipient = toHex(RECIPIENT, { size: 20 });
const intents = { openedAt, salt, executionFee } as const;
const [opened] = routes.compileSauceProgram("ethereum", source("nested-intent.sauce.ts"), {
  args: [recipient, AMOUNT, REWARD, creator],
  intents,
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

// The swap variant, `minOut` the least WETH the swap on Base may buy.
const [swap] = routes.compileSauceProgram("ethereum", source("nested-swap.sauce.ts"), {
  args: [recipient, AMOUNT, REWARD, 1n, creator],
  intents,
}).intents;
if (swap === undefined || swap.captures.length > 0 || swap.intent.route.calls.length !== 2) {
  throw new Error("Expected nested-swap.sauce.ts to open one fixed intent to Base");
}
console.log("The swap variant:", routes.hashIntent(swap.intent).intentHash);
