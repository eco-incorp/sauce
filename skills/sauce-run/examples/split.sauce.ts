// Pays each of `recipients`, from the Pot, `amount` of `token` — and as much again in the chain's
// USDC when `alsoUsdc`.
//
// The values arrive at run time, so one compiled program serves every call:
//
//   sauce run split.sauce.ts --chain base --config sauce.config.json --keystore <path> \
//     --args <token> '["0x…","0x…"]' 1000000 true
//
// It names no chain, so the same file compiles for any chain that registers USDC; `--chain` picks
// which one's. `transfer(token, to, amount)` is the zero-import @sauce/token function, and
// `USDC.transfer(...)` the same SafeERC20 write on the chain's USDC.
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
