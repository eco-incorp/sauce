import { Base, Ethereum, routes } from "@eco-incorp/sauce";
import { toHex } from "viem";

// Offline fixtures. Read the current Kitchen fee before submission: destinationExecutionFee().
const executionFee = 1_000n;
const usdcOn = (chain: typeof Base.chain) => {
  const value = routes.registryTokenAddress(chain, "USDC");
  if (value === undefined) throw new Error("Missing USDC registry");
  return toHex(value, { size: 20 });
};
const baseUsdc = usdcOn(Base.chain);
const sourceUsdc = usdcOn(Ethereum.chain);

// The reward escrowed on Ethereum, what a solver delivers on Base, and the body that runs there with
// it. The body is SauceScript for Base, read as source and never run here, so it names only what
// SauceScript knows: Base's `USDC` and literals. The delivered USDC arrives at Base's Portal
// Executor, and the intent moves it into the Pot the body cooks on: the shared one that Executor
// owns, which must already exist. The deadlines take their defaults, counted from now.
const built = Base.Portal.send({ token: sourceUsdc, amount: 1_010_000n })
  .source("ethereum")
  .creator("0x6666666666666666666666666666666666666666")
  .receive({ token: baseUsdc, amount: 1_000_000n })
  .fee(executionFee)
  .then(() => {
    USDC.transfer(0x2222222222222222222222222222222222222222n, 1_000_000n);
  });

// The reward paid into the intent's vault, then `publish`. Pass `{ vault }` as `built.vaultCall()`
// reads it from the source chain to have it checked against this offline derivation.
const sourceRequests = built.sourceTxs();
if (built.intent.route.calls.length !== 2 || sourceRequests.length !== 2) {
  throw new Error("Expected destination delivery + cook and source transfer + publish");
}
if (sourceRequests[0]?.to.toLowerCase() !== sourceUsdc.toLowerCase()) {
  throw new Error("The reward is transferred in the source chain's USDC");
}
if (
  built.intent.route.calls[1]?.value !== executionFee ||
  built.intent.route.nativeAmount !== executionFee
) {
  throw new Error("Destination funding must include the cook fee");
}
console.log("Ethereum → Base intent:", built.hash().intentHash);
console.log("Prepared source transactions:", sourceRequests.length);
