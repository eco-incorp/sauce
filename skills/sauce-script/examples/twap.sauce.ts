// Reads what a Uniswap V3 pool's time-weighted average price is computed from: its tick cumulative
// `window` seconds ago and now, returned as abi.encode(then, now). The factory and the pool are
// namespaces; `observe`, which the registry's UniswapV3.Pool ABI does not declare, is called
// through the program's own ABI beside it, IOracle.json: that one function, with the pool's
// deployed types. The cumulatives are signed (int56 on chain, an `Int256` here), so the average
// tick over the window is (now - then) / window as a signed division, below zero for a negative tick.
//
//   sauce simulate twap.sauce.ts --chain <chain> \
//     --owner <address> --args <tokenA> <tokenB> <fee> <window>
//
//   tokenA: Address  one token of the pair
//   tokenB: Address  the other
//   fee: Uint256     the pool's fee tier, in millionths: 500 is 0.05%, 3000 is 0.3%
//   window: Uint256  how far back, in seconds: 1800 is 30 minutes
//
// On Base, the WETH/USDC 0.05% pool over 30 minutes:
//
//   sauce simulate twap.sauce.ts --chain base \
//     --owner <address> --args 0x4200000000000000000000000000000000000006 \
//     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 500 1800
import IOracle from "./IOracle.json";

function main(tokenA: Address, tokenB: Address, fee: Uint256, window: Uint256): bytes {
  const pool = UniswapV3.Factory.getPool(tokenA, tokenB, fee);
  require(pool != 0, "no pool for that pair and fee");
  require(UniswapV3.Pool(pool).liquidity() > 0, "the pool has no liquidity");
  // Only what is needed: observe's first result, the tick cumulatives.
  const [ticks] = IOracle.at(pool).observe([window, 0]);
  return abi.encode(ticks[0], ticks[1]);
}
