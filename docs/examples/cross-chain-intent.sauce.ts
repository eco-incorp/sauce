// Create a cross-chain intent from inside a Sauce program.
//
// This runs on one chain as part of an intent's route, measures what the calls before it left in
// the Pot, and offers a NEW intent that carries that amount onward to another chain. The amount is
// never known in advance — it is whatever the swap, bridge or transfer just before it produced —
// which is the reason to build the intent here rather than off-chain.
//
// `Arbitrum.Portal.send(...).receive(...).then(() => { ... })` is the whole of it: what this program
// pays, what a solver delivers on Arbitrum, and what runs there. `amount` is an ordinary variable of
// this program, and using it in the intent is enough: the SDK splices its run-time value into the
// encoded intent, and fills in the Portal, the prover, the vault funding and the encoding.
//
// RECIPIENT is a compile-time `define` the caller supplies. `USDC` is a registered symbol. In
// `.send(...)` it means the USDC of the chain this program runs on, which escrows the reward; in
// `.receive(...)` and inside the braces it means Arbitrum's USDC, because that is where they run.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum.Portal.send({ token: USDC, amount })
    .receive({ token: USDC, amount })
    .then(() => {
      USDC.transfer(RECIPIENT, amount);
    });
}
