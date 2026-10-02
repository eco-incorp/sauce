// A program reaches a catalogued protocol through its registry namespace: `AaveV3.Pool`,
// `PancakeswapV3.Factory`. The address and the ABI come from the registry for the chain the program
// is compiled for, with no import, and `available(...)` uses a contract only where that chain has
// it, so the file compiles for chains without PancakeSwap V3 too.
//
//   sauce run protocols.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <beneficiary> <amount>
//
//   beneficiary: Address  who the Aave V3 position is supplied for
//   amount: Uint256       the Pot's USDC to supply, in its smallest units (6 decimals):
//                         5000000000 is 5,000 USDC
//
// On Base, 5,000 USDC supplied for the beneficiary:
//
//   sauce run protocols.sauce.ts --chain base --keystore <keystore> \
//     --args <beneficiary> 5000000000
function main(beneficiary: Address, amount: Uint256) {
  // 1. Supply `amount` of the Pot's USDC to Aave V3 for `beneficiary`, approving exactly that.
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0);

  // 2. Look a pool up through PancakeSwap V3's factory, where the chain has one.
  if (available(PancakeswapV3.Factory)) {
    const pool = PancakeswapV3.Factory.getPool(WETH, USDC, 500);
    require(pool != 0, "no PancakeSwap V3 WETH/USDC 0.05% pool");
  }
}
