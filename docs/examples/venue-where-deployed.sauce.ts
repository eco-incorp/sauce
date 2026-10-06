// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has
// it, from Uniswap V3 where it does not, and nothing where it has neither venue.
//
// A contract the chain lacks is zero there, and comparing it with zero is decided when the program
// is compiled, for the chain it is compiled for: a branch it rules out is never compiled. A token is
// a bare name: a chain with a venue but without USDC or WETH refuses the program, naming the token.
function main() {
  let pool = 0;
  if (PancakeswapV3.Factory != 0) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  } else if (UniswapV3.Factory != 0) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
}
