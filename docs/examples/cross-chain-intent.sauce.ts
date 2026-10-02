// Create a cross-chain intent from inside a Sauce program.
//
// This runs on your Pot, measures the USDC the calls before it left there, and offers a NEW intent
// that carries that amount to `recipient` on another chain. The amount is never known in advance —
// it is whatever the swap, bridge or transfer just before it produced — which is the reason to
// build the intent here rather than off-chain.
//
// `Ethereum(() => { ... }).reward({ ... })` is the whole of it. `amount` is an ordinary variable of
// this program and `recipient` one of its parameters, and using them inside the intent is enough:
// the SDK splices their run-time values into the encoded intent, and fills in the Portal, the
// prover, the vault and the encoding.
//
// `USDC` is a registered symbol, and inside the braces it means Ethereum's USDC, because that is the
// chain those calls run on. In `.reward(...)` it means the USDC of the chain this program runs on,
// which escrows the reward.
//
//   sauce run cross-chain-intent.sauce.ts --chain base --config sauce.config.json \
//     --keystore <keystore> --intent-deadline <unix seconds> --intent-creator <address> \
//     --args <recipient> <minAmount>
//
//   recipient: Address   who the intent pays on Ethereum
//   minAmount: Uint256   the least USDC worth forwarding, in its smallest units (6 decimals):
//                        below it the whole transaction reverts and nothing is published
function main(recipient: Address, minAmount: Uint256) {
  const amount = USDC.balanceOf(ctx.self());
  require(amount >= minAmount, "nothing to forward");

  Ethereum(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
