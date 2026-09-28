import { Base, destinationPot, Ethereum, routes, token } from "@eco-incorp/sauce";
import { toHex } from "viem";

// Offline fixtures. Read the current Kitchen fee before submission.
const portal = "0x4444444444444444444444444444444444444444";
// The Pot the route cooks on, owned by that Portal's Executor. The route deploys it if missing.
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

const sourceRequests = [...built.approvals(), built.publishAndFundCalldata(false)];
if (built.intent.route.calls.length !== 3 || sourceRequests.length !== 2) {
  throw new Error("Expected Pot deployment + delivery + cook, and source approval + funding");
}
if (
  built.intent.route.calls[2]?.value !== executionFee ||
  built.intent.route.nativeAmount !== executionFee
) {
  throw new Error("Destination funding must include the cook fee");
}
console.log("Ethereum → Base intent:", built.hash().intentHash);
console.log("Prepared source transactions:", sourceRequests.length);
