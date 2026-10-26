// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has it,
// from Uniswap V3 where it does not, and nothing where it has neither venue or lacks either token.
//
// A name the chain lacks is zero there. Each test of a name is decided when the program is compiled,
// for the chain it is compiled for, and the branches it rules out are not compiled.
function main() {
  if (!USDC || !WETH) return 0;
  let pool = 0;
  if (PancakeswapV3.Factory) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500);
  } else if (UniswapV3.Factory) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  }
  return pool;
}
