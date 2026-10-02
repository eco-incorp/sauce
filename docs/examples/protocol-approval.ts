import { Base, Ethereum } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

// Offline fixtures: the creator, and the fee, which destinationExecutionFee() reads for real. The
// Portals, the prover, the Pot, the engine and the route's native amount come from the SDK.
const executionFee = 1_000n;
const options: routes.PortalReceiveOptions = {
  execution: { value: executionFee },
  deadline: 2_000_000_000n,
};

// An approval moves nothing, so the solver delivers nothing; the reward is Ethereum's USDC.
const built = Base.Portal.send(
  { token: Ethereum.USDC.address, amount: 10_000n },
  {
    source: "ethereum",
    creator: "0x4444444444444444444444444444444444444444",
    deadline: 2_000_003_600n,
  },
)
  .receive([], options)
  .then(() => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  });

if (!built.compiled.bytecode[0]?.length || built.intent.route.calls.length !== 1) {
  throw new Error("Expected a compiled approval and one Pot call");
}
if (
  built.intent.route.calls[0]!.value !== executionFee ||
  built.intent.route.nativeAmount !== executionFee
) {
  throw new Error("Expected the destination cook to receive its fee, and the solver to send it");
}
console.log("Base approval intent:", built.hash().intentHash);
