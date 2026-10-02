// Create a cross-chain intent from inside a Sauce program.
//
// This runs on one chain as part of an intent's route, measures what the calls before it left in
// the Pot, and offers a NEW intent that carries that amount onward to another chain. The amount is
// never known in advance — it is whatever the swap, bridge or transfer just before it produced —
// which is the reason to build the intent here rather than off-chain.
//
// `Arbitrum.Portal.send({ ... }).then(() => { ... })` is the whole of it: `send` names the reward,
// and `then` what runs on Arbitrum. `amount` is an ordinary variable of this program, and using it
// inside the intent is enough: the SDK splices its run-time value into the encoded intent, and fills
// in the Portal's address, the prover, the approval and the encoding.
//
// RECIPIENT is a compile-time `define` the caller supplies. `USDC` is a registered symbol, and
// inside the braces it means Arbitrum's USDC, because that is the chain those calls run on. In
// `.send(...)` it means the USDC of the chain this program runs on, which escrows the reward.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum.Portal.send({ token: USDC, amount }).then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
}
