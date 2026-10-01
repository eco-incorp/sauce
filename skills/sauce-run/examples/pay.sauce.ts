// Pays `recipient`, from the Pot, `amount` of USDC and `amount` of USDT.
//
// It names no chain: `--chain` picks one, and `USDC` and `USDT` are that chain's registered tokens,
// so the same file runs on every chain that registers both. `recipient` and `amount` arrive with
// the transaction, so one compiled program serves every call. Each `.transfer` is a SafeERC20
// transfer: USDT, which returns nothing, works like any other token, and a token that answers
// `false` reverts the whole transaction.
//
//   sauce run pay.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <recipient> <amount>
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
  USDT.transfer(recipient, amount);
}
