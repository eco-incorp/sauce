// Pays each of `recipients`, from the Pot, `amount` of `token`, and as much again in the chain's
// USDC when `alsoUsdc`.
//
// The values arrive at run time, so one compiled program serves every call, and it names no
// chain, so the same file compiles for every chain that registers USDC. `transfer(token, to,
// amount)` is the zero-import @sauce/token function, and `USDC.transfer(...)` the same SafeERC20
// write on the chain's USDC.
//
//   sauce run split.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <token> '["<recipient>","<recipient>"]' <amount> true
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
