// A limit buy spread over Base's Aerodrome Slipstream and Uniswap V3 pools: spends up to `budget`
// of `payToken` on `buyToken`, never paying more than `maxPrice` for any unit, fees included.
// Returns abi.encode(spent, bought, unspent).
//
//   sauce run distributed-swap.sauce.ts --chain <chain> \
//     --keystore <keystore> --fund <payToken>:<budget> \
//     --args <payToken> <buyToken> <budget> <maxPrice> <minTokens> <maxAvgPrice> \
//     <recipient> <refundTo>
//
//   payToken: Address     the token paid; the budget must be in the Pot (`--fund` pulls it in)
//   buyToken: Address     the token bought
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included, as payToken base units per
//                         buyToken base unit times 1e18: the price in whole tokens times
//                         10^(18 + payDecimals - buyDecimals), so 150 USDC (6 decimals) for SPCXc
//                         (8 decimals) is 150 × 10^16 = 1500000000000000000
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//   recipient: Address    receives what is bought
//   refundTo: Address     receives what is left of the budget
//
//   Buying SPCXc (8 decimals) on Base with up to 1,000 USDC, at most 150 USDC each, at least 6.6
//   SPCXc in all and an average of at most 149.5:
//   sauce run distributed-swap.sauce.ts --chain base \
//     --keystore <keystore> --fund USDC:1000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
//     1000000000 1500000000000000000 660000000 1495000000000000000 <recipient> <refundTo>
import { uniswapV3 } from "@sauce/router";

// One pool, from either venue: skipped when missing, empty or already past its own limit, else
// offered all of the budget still unspent, up to its own limit. Returns what it bought.
// `slipstream` picks the pool's ABI: a Slipstream pool's slot0 has no feeProtocol.
function trade(
  pool: Address,
  slipstream: bool,
  payToken: Address,
  buyToken: Address,
  kept: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  const unspent = Token(payToken).balanceOf(ctx.self()) - kept;
  if (pool == 0n || unspent == 0n) {
    return 0n;
  }
  let liquidity = 0n;
  let price = 0n;
  let fee = 0n;
  if (slipstream) {
    liquidity = AerodromeSlipstream.Pool(pool).liquidity();
    price = AerodromeSlipstream.Pool(pool).slot0().sqrtPriceX96;
    fee = AerodromeSlipstream.Pool(pool).fee();
  } else {
    liquidity = UniswapV3.Pool(pool).liquidity();
    price = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
    fee = UniswapV3.Pool(pool).fee();
  }
  // The pool's own limit: the caller's moved by √(1 − fee), so that its last unit, fee paid,
  // costs exactly maxPrice. Paying token0 pushes the price down, token1 pushes it up.
  const paysToken0 = payToken < buyToken;
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  const own = paysToken0
    ? Math.mulDiv(limit, 10n ** 18n, root)
    : Math.mulDiv(limit, root, 10n ** 18n);
  const better = paysToken0 ? price > own : price < own;
  if (liquidity == 0n || !better) {
    return 0n;
  }
  return uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
}

function main(
  payToken: Address,
  buyToken: Address,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address,
): bytes {
  const self = ctx.self();
  const pay = Token(payToken);
  require(maxPrice > 0n, "maxPrice is 0");
  require(pay.balanceOf(self) >= budget, "budget is not in the Pot");
  const kept = pay.balanceOf(self) - budget; // the Pot's other payToken, never spent
  let bought = 0n;

  // maxPrice as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs maxPrice.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1n << 192n, 10n ** 18n));
  if (payToken < buyToken) {
    limit = Math.sqrt(Math.mulDiv(1n << 192n, 10n ** 18n, maxPrice));
  }

  // The loops only find pools; trade() decides and swaps. Slipstream, keyed by tick spacing.
  for (const spacing of [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    bought += trade(pool, true, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V3, keyed by fee tier: the seven Base's factory enables.
  for (const fee of [100n, 200n, 300n, 400n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    bought += trade(pool, false, payToken, buyToken, kept, limit, recipient);
  }

  // Settle: what was bought is already with the recipient; what is left of the budget goes back.
  const unspent = pay.balanceOf(self) - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0n || spent * 10n ** 18n <= maxAvgPrice * bought, "average too high");
  if (unspent > 0n) {
    pay.transfer(refundTo, unspent);
  }
  return abi.encode(spent, bought, unspent);
}
