// Reads a Uniswap V3 pool's price and liquidity, for a pair and a fee tier, and returns
// abi.encode(sqrtPriceX96, liquidity). The factory is a namespace; the pool is called through the
// program's own ABI beside it, IPool.json: only the two functions it calls, with the pool's
// deployed types.
//
//   sauce simulate pool-state.sauce.ts --chain <chain> --config sauce.config.json \
//     --owner <address> --args <tokenA> <tokenB> <fee>
//
//   tokenA: Address  one token of the pair
//   tokenB: Address  the other
//   fee: Uint256     the pool's fee tier, in millionths: 500 is 0.05%, 3000 is 0.3%
//
// On Base, the WETH/USDC 0.05% pool:
//
//   sauce simulate pool-state.sauce.ts --chain base --config sauce.config.json \
//     --owner <address> --args 0x4200000000000000000000000000000000000006 \
//     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 500
import IPool from "./IPool.json";

function main(tokenA: Address, tokenB: Address, fee: Uint256): bytes {
  const pool = UniswapV3.Factory.getPool(tokenA, tokenB, fee);
  require(pool != 0n, "no pool for that pair and fee");
  // Only what is needed: slot0's first field.
  const [sqrtPriceX96] = IPool.at(pool).slot0();
  return abi.encode(sqrtPriceX96, IPool.at(pool).liquidity());
}
