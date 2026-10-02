// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has it,
// from Uniswap V3 where it does not, and nothing where it has neither venue or lacks either token.
//
// A contract the chain lacks is zero there, and comparing it with zero is decided when the program
// is compiled, for the chain it is compiled for: a branch it rules out is never compiled.
function main() {
  if (USDC == 0 || WETH == 0) return 0;
  let pool = 0;
  if (PancakeswapV3.Factory != 0) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  } else if (UniswapV3.Factory != 0) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
}
