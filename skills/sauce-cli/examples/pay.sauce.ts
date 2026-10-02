// Pays `recipient`, from the Pot, `amount` of USDC and `amount` of USDT.
//
// It names no chain: `--chain` picks one, and `USDC` and `USDT` are that chain's registered tokens,
// so the same file runs on every chain that registers both. `recipient` and `amount` arrive with
// the transaction, so one compiled program serves every call. Each `.transfer` is a SafeERC20
// transfer: USDT, which returns nothing, works like any other token, and a token that answers
// `false` reverts the whole transaction.
//
//   sauce run pay.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <recipient> <amount>
//
//   recipient: Address  who is paid
//   amount: Uint256     how much of each token, in its smallest units: USDC and USDT have 6
//                       decimals, so 1000000 is 1 USDC and 1 USDT
//
// On Ethereum, 1 USDC and 1 USDT to the recipient:
//
//   sauce run pay.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> 1000000
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
  USDT.transfer(recipient, amount);
}
