import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

// Offline fixtures. Read the destination Kitchen fee before use. The Pot and engine are derived.
const executionFee = 1_000n;
const options: routes.IntentOptions = {
  execution: { value: executionFee },
  nativeAmount: executionFee,
  portal: "0x3333333333333333333333333333333333333333",
  deadline: 2_000_000_000n,
};

const built = Base(() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
}, options).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  prover: "0x5555555555555555555555555555555555555555",
  deadline: 2_000_003_600n,
  nativeAmount: 0n,
});

// The Pot's deployment (a no-op once it exists), then the cook.
if (!built.compiled.bytecode[0]?.length || built.intent.route.calls.length !== 2) {
  throw new Error("Expected a compiled approval, and the Pot's deployment before its cook");
}
if (built.intent.route.calls[1]!.value !== executionFee) {
  throw new Error("Expected the destination cook to receive its fee");
}
console.log("Base approval intent:", built.hash().intentHash);
