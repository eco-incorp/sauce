// A limit buy over Base's Aerodrome Slipstream, Uniswap V3 and hookless Uniswap V4 pools: up to
// `budget` of `payToken` for `buyToken`, never more than `priceLimit` for any unit, fees included.
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --fund <payToken>:<budget> --args <payToken> <buyToken> <budget> <priceLimit> <minTokens> \
//     <maxAvgPrice> <recipient>
//
//   payToken: Address     the token paid; the budget must be in the Pot (`--fund` pulls it in)
//   buyToken: Address     the token bought
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   priceLimit: Uint256   the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in priceLimit's units; 0 turns it off
//   recipient: Address    receives what is bought, and what is left of the budget
//
//   SPCXc (8 decimals) for all of 1,000 USDC (6) or nothing, at most 150 each, 149.25 on average:
//   sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> --fund USDC:1000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xb2000000000000000000007b9fcbd005511aCBd5 \
//     1000000000 1500000000000000000 666666667 1492500000000000000 <recipient>
//   WETH (18 decimals) for all of 3,000 USDC or nothing, at most 2,713.5 each, 2,706.75 on average:
//   sauce run distributed-swap.sauce.ts --chain base --keystore <keystore> --fund USDC:3000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 \
//     3000000000 2713500000 1105583195135433942 2706750000 <recipient>
import { uniswapV3, uniswapV4 } from "@sauce/router";

// One pool: skipped when missing, empty or already past its own limit, else offered all of the
// budget still unspent, up to its own limit. Returns what it bought.
function trade(
  venue: Uint256, // 0 Uniswap V3, 1 Slipstream, 2 Uniswap V4
  pool: Uint256, // the pool's address; a V4 pool has none, and this is its id, a 256-bit hash
  spacing: Uint256, // a V4 pool's tick spacing
  payToken: Address,
  buyToken: Address,
  kept: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  const unspent = Token(payToken).balanceOf(ctx.self()) - kept;
  if (pool == 0 || unspent == 0) {
    return 0;
  }
  const paysToken0 = payToken < buyToken;
  let liquidity = 0;
  let price = 0;
  let fee = 0;
  let lpFee = 0;
  if (venue == 0) {
    liquidity = UniswapV3.Pool(pool).liquidity();
    price = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
    fee = UniswapV3.Pool(pool).fee();
  } else if (venue == 1) {
    // Slipstream's own binding: its slot0 has no feeProtocol, and its fee can change any block.
    liquidity = AerodromeSlipstream.Pool(pool).liquidity();
    price = AerodromeSlipstream.Pool(pool).slot0().sqrtPriceX96;
    fee = AerodromeSlipstream.Pool(pool).fee();
  } else {
    // A missing V4 pool reads as empty. Its fee: this direction's protocol fee (paying token0's in
    // the low 12 bits, token1's in the next 12), then the LP fee on the rest.
    liquidity = UniswapV4.StateView.getLiquidity(pool);
    const [sqrtPriceX96, , protocolFees, poolFee] = UniswapV4.StateView.getSlot0(pool);
    const protocolFee = (paysToken0 ? protocolFees : protocolFees >> 12) & 0xfff;
    price = sqrtPriceX96;
    lpFee = poolFee;
    fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000;
  }
  // The pool's own limit: the caller's moved by √(1 − fee), so that its last unit, fee paid,
  // costs exactly priceLimit. Paying token0 pushes the price down, token1 pushes it up.
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // √(1 − fee), times 1e18
  const own = paysToken0 ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);
  const better = paysToken0 ? price > own : price < own;
  if (liquidity == 0 || !better) {
    return 0;
  }
  if (venue == 2) {
    // A hookless pool's LP fee is its key's fee.
    const manager = UniswapV4.PoolManager;
    return uniswapV4(manager, payToken, buyToken, unspent, lpFee, spacing, 0, own, 0, recipient);
  }
  // A Slipstream pool swaps and calls back as a Uniswap V3 pool does: uniswapV3 swaps both.
  return uniswapV3(pool, payToken, buyToken, unspent, own, 0, recipient);
}

function main(
  payToken: Address,
  buyToken: Address,
  budget: Uint256,
  priceLimit: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  const self = ctx.self();
  const pay = Token(payToken);
  require(priceLimit > 0, "priceLimit is 0");
  require(pay.balanceOf(self) >= budget, "budget is not in the Pot");
  const kept = pay.balanceOf(self) - budget; // the Pot's other payToken, never spent
  let bought = 0;

  // priceLimit as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs priceLimit.
  let limit = Math.sqrt(Math.mulDiv(priceLimit, 1 << 192, 10 ** 18));
  if (payToken < buyToken) {
    limit = Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, priceLimit));
  }

  // The loops only find pools; trade() decides and swaps. Slipstream, keyed by tick spacing.
  for (const spacing of [1, 10, 50, 80, 100, 150, 200, 500, 2000]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    bought += trade(1, pool, 0, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V3, keyed by fee tier: the seven Base's factory enables.
  for (const fee of [100, 200, 300, 400, 500, 3000, 10000]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    bought += trade(0, pool, 0, payToken, buyToken, kept, limit, recipient);
  }
  // Uniswap V4, hookless, keyed by fee and tick spacing: the four standard keys. A pool is its id,
  // the hash of its key, the pair in address order: 256 bits, so a Uint256, never an Address.
  const low = payToken < buyToken ? payToken : buyToken;
  const high = payToken < buyToken ? buyToken : payToken;
  for (const key of [
    { fee: 100, spacing: 1 },
    { fee: 500, spacing: 10 },
    { fee: 3000, spacing: 60 },
    { fee: 10000, spacing: 200 },
  ]) {
    const id = crypto.keccak256(abi.encode(low, high, key.fee, key.spacing, 0));
    bought += trade(2, id, key.spacing, payToken, buyToken, kept, limit, recipient);
  }

  // Settle: the recipient already has what was bought; what is left of the budget goes there too.
  const unspent = pay.balanceOf(self) - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (unspent > 0) {
    pay.transfer(recipient, unspent);
  }
  return { spent, bought, unspent };
}
