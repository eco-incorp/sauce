// Sells `amountIn` of `tokenIn` for USDC at the chain's Uniswap V3 pool at fee tier `fee`, then
// deposits exactly the USDC the swap delivered into Circle Gateway for `depositor`. The swap stops
// at `sqrtPriceLimitX96` and reverts below `minUsdc`; the input the pool did not take goes back to
// `depositor`. The output is measured as the Pot's USDC before and after, never its whole balance,
// which on Arc is also the native coin. Gateway's burn intents and attestations are off-chain, so
// the program ends at the deposit and reads the balance back.
// Returns the USDC deposited and the depositor's Gateway balance.
//
//   sauce run swap-then-gateway.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenIn> <fee> <amountIn> <sqrtPriceLimitX96> <minUsdc> <depositor>
//
//   tokenIn: Address            the token sold for USDC
//   fee: Uint256                the Uniswap V3 pool's fee tier, in millionths: 500 is 0.05%
//   amountIn: Uint256           how much `tokenIn` to sell, in its base units: 100000000 is
//                               100 EURC (6 decimals); the Pot must hold it
//   sqrtPriceLimitX96: Uint256  the pool price past which nothing more is sold, as the pool
//                               states it (`sauce price` turns "1.1 USDC per EURC" into it)
//   minUsdc: Uint256            the least USDC to accept and deposit, in its base units (6
//                               decimals, on Arc too): 110000000 is 110 USDC; less reverts
//   depositor: Address          whose Gateway balance is credited, and who receives the unsold
//                               `tokenIn`: the user's own address
//
// On Arc, 100 EURC sold on Uniswap V3's 0.05% EURC/USDC pool, never below 1.1 USDC per EURC, for
// at least 110 USDC, all of it deposited into Gateway for the user:
//
//   sauce simulate swap-then-gateway.sauce.ts --chain arc --owner <owner> \
//     --assume-balance EURC:100 --args 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1 500 100000000 \
//     75541088972021052632782079082 110000000 <depositor>
import { uniswapV3 } from "@sauce/router";

function main(
  tokenIn: Address,
  fee: Uint256,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minUsdc: Uint256,
  depositor: Address,
): { deposited: Uint256; total: Uint256 } {
  require(CircleGateway.GatewayWallet.isTokenSupported(USDC), "Gateway does not take USDC here");
  const pool = UniswapV3.Factory.getPool(tokenIn, USDC, fee);
  require(pool != 0, "no pool at that fee tier");
  const inBefore = Token(tokenIn).balanceOf(pot);
  require(inBefore >= amountIn, "amountIn is not in the Pot");

  // The USDC arrives in the Pot, measured as a delta, and uniswapV3 reverts below minUsdc.
  const usdcBefore = pot.USDC;
  uniswapV3(pool, tokenIn, USDC, amountIn, sqrtPriceLimitX96, minUsdc, pot);
  const got = pot.USDC - usdcBefore;
  require(got >= minUsdc, "the swap delivered less than minUsdc");

  // The rest of amountIn: what the pool did not take.
  const unspent = amountIn - (inBefore - Token(tokenIn).balanceOf(pot));
  if (unspent > 0) {
    Token(tokenIn).transfer(depositor, unspent);
  }

  // depositFor credits the depositor; deposit would credit the Pot.
  const before = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  USDC.approve(CircleGateway.GatewayWallet, got);
  CircleGateway.GatewayWallet.depositFor(USDC, depositor, got);
  const total = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  require(total - before == got, "the Gateway balance did not rise by the deposit");
  return { deposited: got, total };
}
