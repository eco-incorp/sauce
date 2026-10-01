// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has it,
// from Uniswap V3 where it does not, and nothing where it has neither.
//
// A contract the chain lacks is zero there, and comparing it with zero is decided when the program
// is compiled, for the chain it is compiled for: a branch it rules out is never compiled.
function main() {
  let pool = 0n;
  if (PancakeswapV3.Factory != 0n) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
  } else if (UniswapV3.Factory != 0n) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
  }
  return pool;
}
