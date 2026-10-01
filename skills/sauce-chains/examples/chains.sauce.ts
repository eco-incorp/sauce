// One file for every chain: compiled with `--chain`, each name below resolves to that chain's token
// or contract, and a chain without one refuses to compile. It checks that it runs on the chain it
// was compiled for and that the chain's Uniswap V3 factory has a USDC/WETH pool at `fee`, then pays
// `amount` of the chain's USDC to `recipient`.
//
//   sauce tx chains.sauce.ts --chain <chain> --owner <address> --args <recipient> <amount> <fee>
function main(recipient: Address, amount: Uint256, fee: Uint256) {
  // `chainId` is the id of the chain the file was compiled for; ctx.chainId() is where it runs.
  require(ctx.chainId() == chainId, "compiled for another chain");
  // A namespace contract is called with no import; `USDC` and `WETH` are this chain's tokens.
  const pool = UniswapV3.Factory.getPool(USDC, WETH, fee);
  require(pool != 0n, "no USDC/WETH pool at that fee");
  USDC.transfer(recipient, amount);
}
