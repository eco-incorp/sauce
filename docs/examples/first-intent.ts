import { Base, destinationPot, Ethereum, routes, token } from "@eco-incorp/sauce";
import { toHex } from "viem";

// Offline fixtures. Read the current Kitchen fee before submission.
const portal = "0x4444444444444444444444444444444444444444";
// The Pot the route cooks on: the shared one owned by that Portal's Executor. It must already exist.
const pot = destinationPot(Base.chain, { portal });
const executionFee = 1_000n;
const baseUsdcValue = routes.registryTokenAddress(Base.chain, "USDC");
const sourceUsdcValue = routes.registryTokenAddress(Ethereum.chain, "USDC");
if (baseUsdcValue === undefined || sourceUsdcValue === undefined)
  throw new Error("Missing USDC registry");
const baseUsdc = toHex(baseUsdcValue, { size: 20 });
const sourceUsdc = toHex(sourceUsdcValue, { size: 20 });
const recipient = 0x2222222222222222222222222222222222222222n;
const amount = 1_000_000n;

const built = Base(
  () => {
    USDC.transfer(recipient, amount);
  },
  {
    execution: { value: executionFee },
    nativeAmount: executionFee,
    portal,
    sourcePortal: "0x5555555555555555555555555555555555555555",
    deadline: 2_000_000_000n,
    // Callbacks capture nothing: explicitly supply every external scalar.
    defines: { recipient, amount },
    tokens: [{ token: baseUsdc, amount }],
    // Route assets arrive at the Executor; the Sauce program spends from the Pot.
    precalls: [token.Token.transfer({ token: baseUsdc, to: pot, amount }).toCall()],
  },
).reward({
  source: Ethereum.chain,
  creator: "0x6666666666666666666666666666666666666666",
  prover: "0x7777777777777777777777777777777777777777",
  deadline: 2_000_003_600n,
  tokens: [{ token: sourceUsdc, amount }],
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
