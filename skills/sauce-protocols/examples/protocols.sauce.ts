// A program reaches a catalogued protocol through its registry namespace: `AaveV3.Pool`,
// `PancakeswapV3.Factory`. The address and the ABI come from the registry for the chain the program
// is compiled for, with no import, and `available(...)` uses a contract only where that chain has
// it, so the file compiles for chains without PancakeSwap V3 too.
//
//   sauce run protocols.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <beneficiary> <amount>
function main(beneficiary: Address, amount: Uint256) {
  // 1. Supply `amount` of the Pot's USDC to Aave V3 for `beneficiary`, approving exactly that.
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0n);

  // 2. Look a pool up through PancakeSwap V3's factory, where the chain has one.
  if (available(PancakeswapV3.Factory)) {
    const pool = PancakeswapV3.Factory.getPool(WETH, USDC, 500n);
    require(pool != 0n, "no PancakeSwap V3 WETH/USDC 0.05% pool");
  }
}
