import { Base, Ethereum } from "@eco-incorp/sauce";

// Offline fixtures: the refundee, the reward, and Base's Kitchen fee, which
// destinationExecutionFee() reads for real. The Portals, the prover, the Pot, the engine and the
// route's native amount come from the SDK. The intent needs no delivery: it shows a body that names
// a protocol contract, `Uniswap.UniversalRouter`, resolved on Base, where it runs.
const executionFee = 1_000n;

const built = Base.hop({
  source: Ethereum,
  send: { token: Ethereum.USDC.address, amount: 10_000n },
  refundee: "0x4444444444444444444444444444444444444444",
  fee: executionFee,
}).then(() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
});

if (built.program.bodies.length !== 1 || !built.source.includes("fee: 1000,")) {
  throw new Error("Expected one body, cooked on Base with its fee");
}
console.log(`Base approval intent: a program of ${built.program.bytecode.length} bytes`);
