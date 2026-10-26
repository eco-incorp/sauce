// What the Pot holds on the chain this file is compiled for, and that chain's USDC/WETH Uniswap V3
// pool at `fee`. The file names no chain and no address: compiled with `--chain`, `USDC`, `WETH`
// and `bCSPX` (Backed's tokenized S&P 500 fund) are that chain's tokens and `UniswapV3.Factory`
// its factory, and a chain without one of them refuses to compile it. `sauce simulate` runs
// the cook, sends nothing and prints what `main` returns; `sauce compile --json` lists what each
// name resolved to.
//
//   sauce simulate holdings.sauce.ts --chain <chain> --owner <address> --args <fee>
//
//   fee: Uint256  the pool's fee tier, in millionths: 500 is 0.05%, 3000 is 0.3%
//
// On Base, the 0.05% pool, and the addresses the names became there:
//
//   sauce simulate holdings.sauce.ts --chain base --owner <address> --args 500
//   sauce compile holdings.sauce.ts --chain base --json
function main(fee: Uint256): { pool: Address; usdc: Uint256; weth: Uint256; bcspx: Uint256 } {
  // This chain's factory, asked for this chain's pair: the pool is another contract on each chain.
  const pool = UniswapV3.Factory.getPool(USDC, WETH, fee);
  require(pool != 0, "no USDC/WETH pool at that fee on this chain");
  return {
    pool: pool,
    usdc: pot.USDC,
    weth: pot.WETH,
    bcspx: pot.bCSPX,
  };
}
