// Pays each of `recipients`, from the Pot, `amount` of `token`, and as much again in the chain's
// USDC when `alsoUsdc`.
//
// The values arrive at run time, so one compiled program serves every call, and it names no
// chain, so the same file compiles for every chain that registers USDC. `transfer(token, to,
// amount)` is the zero-import @sauce/token function, and `USDC.transfer(...)` the same SafeERC20
// write on the chain's USDC.
//
//   sauce run split.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <token> <recipients> <amount> <alsoUsdc>
//
//   token: Address         the ERC-20 to pay
//   recipients: Address[]  who is paid, a JSON array: '["<recipient>","<recipient>"]'
//   amount: Uint256        what each recipient gets, in `token`'s smallest units (and in USDC's,
//                          6 decimals, when alsoUsdc): 1000000000000000 is 0.001 WETH (18 decimals)
//   alsoUsdc: bool         true to pay each recipient `amount` of USDC as well, else false
//
// On Base, 0.001 WETH to each of two recipients:
//
//   sauce run split.sauce.ts --chain base --keystore <keystore> \
//     --args 0x4200000000000000000000000000000000000006 '["<recipient>","<recipient>"]' \
//     1000000000000000 false
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
