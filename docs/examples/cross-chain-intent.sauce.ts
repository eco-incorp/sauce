// Create a cross-chain intent from inside a Sauce program.
//
// This runs on your Pot, measures the USDC the calls before it left there, and offers a NEW intent
// that carries that amount to `recipient` on another chain. The amount is never known in advance —
// it is whatever the swap, bridge or transfer just before it produced — which is the reason to
// build the intent here rather than off-chain.
//
// `Ethereum.hop({ reward, receive, refundee }).then(() => { ... })` is the whole of it: the
// reward this program escrows, what a solver delivers on Ethereum, and what runs there. `amount` is
// an ordinary variable of this program and `recipient` one of its parameters, and using them in the
// intent is enough: the program encodes the intent as it runs, with their values, and the SDK fills
// in the Portal, the prover, the vault and the encoding. The intent names its refundee, `refundTo`,
// where its reward goes back if no solver fills it: no intent has a default refundee. The body runs
// on Ethereum as a program, on the Pot every intent there shares, and its cook pays Ethereum's
// Kitchen fee, which the command reads there. The deadlines and the salt take their defaults.
//
// `USDC` is a registered symbol. In the body it means Ethereum's USDC, the chain the body runs on,
// and so it does in `receive`, whose tokens are looked up again on Ethereum by symbol (its amounts
// are computed here). In `reward` it means the USDC of the chain this program runs on, which
// escrows the reward.
//
//   sauce run cross-chain-intent.sauce.ts --chain base --keystore <keystore> \
//     --args <recipient> <minAmount> <refundTo>
//
//   recipient: Address   who the intent pays on Ethereum
//   minAmount: Uint256   the least USDC worth forwarding, in its smallest units (6 decimals):
//                        below it the whole transaction reverts and nothing is published
//   refundTo: Address    who reclaims the reward if no solver earns it
function main(recipient: Address, minAmount: Uint256, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  require(amount >= minAmount, "nothing to forward");

  Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(recipient, amount);
  });
}
