// An intent from Base to Ethereum, built in TypeScript: the reward escrowed on Base, what a solver
// delivers on Ethereum, and the body that runs there with it. `.then(...)` writes the statement a
// program opens the intent with, compiles it for Base, and returns the program and the cook that
// publishes it from a Pot there.
import { Base, Ethereum, routes } from "@eco-incorp/sauce";
import { toHex } from "viem";

// Offline fixtures: the Pot's owner, who also names the refundee, and Ethereum's Kitchen fee, which
// the body's cook pays: read it with destinationExecutionFee(). The Portals, the prover, the
// destination's Pot and engine and the deadlines come from the SDK.
const owner = "0x4444444444444444444444444444444444444444";
const ethereumFee = 1_000n;
const usdcOn = (chain: typeof Base.chain) => {
  const value = routes.registryTokenAddress(chain, "USDC");
  if (value === undefined) throw new Error("Missing USDC registry");
  return toHex(value, { size: 20 });
};

// The body is SauceScript for Ethereum, read as source and never run here, so it names only what
// SauceScript knows: Ethereum's `USDC` and literals. The delivered USDC arrives at Ethereum's
// Portal Executor, and the intent moves it into the Pot the body cooks on: the shared one that
// Executor owns.
export const built = Ethereum.hop({
  source: Base,
  send: { token: usdcOn(Base.chain), amount: 1_010_000n },
  receive: { token: usdcOn(Ethereum.chain), amount: 1_000_000n },
  refundee: owner,
  fee: ethereumFee,
}).then(() => {
  USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);
});

// The cook, from the owner's Pot on Base, with Base's Kitchen fee as its value (a fixture here).
// The Pot pays the reward into the intent's vault, so it holds the reward first. Send it, or
// rehearse it with eth_simulateV1, and read the intent from the Portal's `IntentPublished` in its
// logs: `built.intents(receipt.logs)`, each with its `intentHash`. The hash is the Portal's: the
// deadlines count from when the cook runs.
const cook = built.cook({ owner }, 1_000n);

const [body] = built.program.bodies;
if (built.program.chain.slug !== "base" || body?.destination.slug !== "ethereum") {
  throw new Error("Expected a program for Base whose body runs on Ethereum");
}
console.log(`Base → Ethereum: a program of ${built.program.bytecode.length} bytes`);
console.log(`Its cook: to ${cook.to}, ${(cook.data.length - 2) / 2} bytes, value ${cook.value}`);
