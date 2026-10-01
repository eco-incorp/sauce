// A program reaches a catalogued protocol through its registry namespace: `AaveV3.Pool`,
// `PancakeswapV3.Factory`. The address and the ABI come from the registry for the chain the program
// is compiled for, with no import. A contract the chain lacks is zero there, so comparing it with
// zero uses it only where that chain has it, and the file compiles for chains without PancakeSwap V3
// too.
//
//   sauce run protocols.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <beneficiary> <amount>
function main(beneficiary: Address, amount: Uint256) {
  // 1. Supply `amount` of the Pot's USDC to Aave V3 for `beneficiary`, approving exactly that.
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0n);

  // 2. Look a pool up through PancakeSwap V3's factory, where the chain has one.
  if (PancakeswapV3.Factory != 0n) {
    const pool = PancakeswapV3.Factory.getPool(WETH, USDC, 500n);
    require(pool != 0n, "no PancakeSwap V3 WETH/USDC 0.05% pool");
  }
}
