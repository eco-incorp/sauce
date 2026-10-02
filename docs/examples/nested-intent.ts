// Builds an Ethereum -> Base intent whose body, nested-intent.sauce.ts, opens a Base -> Ethereum
// intent when it runs; and compiles nested-swap.sauce.ts, whose inner reward is a swap's output.
//
// Offline: the creator, the recipient, the pool and the fee are fixtures and nothing is sent. The
// Portals, the provers, the Pot, the engine and the route's native amount come from the SDK.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Base, destinationPot, Ethereum, routes, token } from "@eco-incorp/sauce";
import { toHex } from "viem";

const source = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
const usdcOn = (chain: typeof Base.chain) => {
  const value = routes.registryTokenAddress(chain, "USDC");
  if (value === undefined) throw new Error("Missing USDC registry");
  return toHex(value, { size: 20 });
};

const executionFee = 1_000n; // Fixture: Base's Kitchen fee, read with destinationExecutionFee().
const amount = 1_000_000n;
const baseUsdc = usdcOn(Base.chain);

const built = Base(source("nested-intent.sauce.ts"), {
  execution: { value: executionFee },
  deadline: 2_000_000_000n,
  // Every intent the body opens inherits the deadline and the creator.
  creator: "0x4444444444444444444444444444444444444444",
  defines: { RECIPIENT: 0x6666666666666666666666666666666666666666n, MIN_AMOUNT: 1n },
  // What the solver brings to Base. It arrives at the Executor; the body measures the Pot.
  tokens: [{ token: baseUsdc, amount }],
  precalls: [
    token.Token.transfer({ token: baseUsdc, to: destinationPot(Base.chain), amount }).toCall(),
  ],
}).reward({
  source: Ethereum.chain,
  deadline: 2_000_003_600n,
  tokens: [{ token: usdcOn(Ethereum.chain), amount: amount + 10_000n }],
});

// The delivery into the Pot, then the cook. The inner intent is not built here: the cook builds it
// on Base, around the amount it measures, and publishes it there.
if (built.intent.route.calls.length !== 2 || built.intent.route.nativeAmount !== executionFee) {
  throw new Error("Expected the delivery and one cook, paid its fee");
}
console.log("Ethereum → Base → Ethereum:", built.hash().intentHash);

// The swap variant, compiled for Base as the same kind of body.
const swap = routes.compileSauceProgram("base", source("nested-swap.sauce.ts"), {
  defines: {
    POOL: 0xd0b53d9277642d899df5c87a3966a349a798f224n, // Base's Uniswap V3 WETH/USDC pool
    MIN_OUT: 1n,
    RECIPIENT: 0x6666666666666666666666666666666666666666n,
  },
  intents: {
    deadline: 2_000_000_000n,
    creator: "0x4444444444444444444444444444444444444444",
  },
});
console.log(`Swap, then an intent of its own: ${swap.bytecode.length} bytes`);
