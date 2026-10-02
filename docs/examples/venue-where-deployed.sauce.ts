// One program for every chain: the USDC/WETH 0.05% pool from PancakeSwap V3 where the chain has it,
// from Uniswap V3 where it does not, and nothing where it has neither.
//
// `available(...)` is decided when the program is compiled, for the chain it is compiled for, and
// the branches it rules out are removed before anything in them is resolved.
function main() {
  let pool = 0n;
  if (available(PancakeswapV3.Factory)) {
    pool = PancakeswapV3.Factory.getPool(USDC, WETH, 500n);
  } else if (available(UniswapV3.Factory)) {
    pool = UniswapV3.Factory.getPool(USDC, WETH, 500n);
  }
  return pool;
}
