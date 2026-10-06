// An Ethereum -> Base intent whose body opens a Base -> Ethereum intent when it runs, written as a
// closure; then nested-intent.sauce.ts, the file `sauce intent publish` cooks on your Pot to open
// the same intent, its `main` arguments read as the cook runs, and nested-swap.sauce.ts, whose
// inner reward is a swap's output.
//
// Offline: the refundee, the recipient, the amounts and the fee are fixtures; nothing is sent. The
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

const AMOUNT = 1_000_000n;
const REWARD = 1_010_000n;
const executionFee = 1_000n; // Fixture: Base's Kitchen fee, read with destinationExecutionFee().
const creator = "0x4444444444444444444444444444444444444444";

// When the intent opens, and its salt: the `sauce` command takes them from the clock and at random,
// and fixtures here.
const openedAt = 2_000_000_000n;
const salt = `0x${"5a".repeat(32)}` as const;

const built = Base.Portal.send({ token: usdcOn(Ethereum.chain), amount: REWARD })
  .source("ethereum")
  .refundee(creator)
  .receive({ token: baseUsdc, amount: AMOUNT })
  .fee(executionFee)
  .deadline(openedAt + routes.DEFAULT_FILL_WINDOW)
  .salt(salt)
  .then(() => {
    // Runs on Base, in the fill of this intent, on a Pot every intent to Base shares: it moves what
    // this intent delivered, never the Pot's whole balance.
    const payout = 1_000_000n - 1_000_000n / 1000n;
    // Opened, funded in Base's USDC and published on Base, in that same fill: its deadlines count
    // from then. Every intent a program opens names its refundee.
    Ethereum.Portal.send({ token: USDC, amount: 1_000_000n })
      .refundee(0x4444444444444444444444444444444444444444n)
      .receive({ token: USDC, amount: payout })
      .fee(1_000n) // Fixture: Ethereum's Kitchen fee, which this body's cook pays.
      .salt(0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5an)
      .then(() => {
        USDC.transfer(0x6666666666666666666666666666666666666666n, payout);
      });
  });
// The program that opens it on Ethereum, and the bodies it compiled: Base's, and the one Base's
// opens back on Ethereum. A cook on your Pot there publishes it (`built.cook(...)`), and its hash is
// read from the Portal's `IntentPublished` in the cook's logs (`built.intents(logs)`).
if (built.program.bodies.length !== 2)
  throw new Error("Expected a body on Base and one on Ethereum");
console.log(`Ethereum → Base → Ethereum: a program of ${built.program.bytecode.length} bytes`);

// The file form, compiled for Ethereum where it opens its intent: a program whose body on Base
// opens the next intent, back to Ethereum. Its intents are encoded as it runs, so they are read
// from the Portal's `IntentPublished` once a cook publishes them (`routes.intentFromPublished`).
const source = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
const intents = { openedAt, salt, executionFee } as const;
const file = routes.compileSauceProgram("ethereum", source("nested-intent.sauce.ts"), { intents });
if (
  file.bodies
    .map((body) => body.destination.slug)
    .sort()
    .join() !== "base,ethereum"
) {
  throw new Error("Expected the file to compile a body for Base, which opens one for Ethereum");
}
console.log(`The file: main(${file.entryParams.map((param) => param.name).join(", ")})`);

// The swap variant, `minOut` the least WETH the swap on Base may buy.
const swap = routes.compileSauceProgram("ethereum", source("nested-swap.sauce.ts"), { intents });
if (swap.bodies.length !== 2) {
  throw new Error("Expected nested-swap.sauce.ts to compile a body for each of its two intents");
}
console.log(`The swap variant: a program of ${swap.bytecode.length} bytes`);
