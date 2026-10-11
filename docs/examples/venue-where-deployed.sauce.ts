// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has
// it, from Uniswap V3 where it does not, and nothing where it has neither venue.
//
// A contract the chain lacks is `undefined` there, so testing it is decided when the program is
// compiled, for the chain it is compiled for: a branch it rules out is never compiled. A token the
// chain lacks is `undefined` too: used without a test, the program does not compile there.
function main() {
  let pool = 0;
  if (PancakeswapV3.Factory) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  } else if (UniswapV3.Factory) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
}
