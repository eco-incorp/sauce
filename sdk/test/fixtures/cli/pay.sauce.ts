// The CLI suites' smallest program: pays `recipient` `amount` of USDC and `amount` of USDT from the
// Pot. It names no chain, so `--chain` picks the chain whose USDC and USDT it pays in, and its
// arguments arrive with the cook. Each `.transfer` is a SafeERC20 write: USDT, which returns
// nothing, works, and a token that answers `false` reverts the cook.
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
  USDT.transfer(recipient, amount);
}
