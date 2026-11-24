// Swaps the Pot's `tokens[0]` for the last of `tokens` through a route of Uniswap V3 pools, in one
// call to the SwapRouter: `fees[i]` is the fee tier of the pool between `tokens[i]` and
// `tokens[i + 1]`. The router reads the route as a path: each token's 20 bytes with the 3 bytes of
// the next pool's fee between them, which the program writes. Selling exactly `amount` (`exactOut`
// false) the path runs from the first token, and `limit` is the least to receive; buying exactly
// `amount` (`exactOut` true) it runs from the last, and `limit` is the most to pay. What an exact
// output leaves of the allowance is withdrawn. Returns what was paid and what `recipient` received.
//
//   sauce run swap-path.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokens> <fees> <exactOut> <amount> <limit> <recipient>
//
//   tokens: Address[]  the route's tokens, from the one paid to the one bought, as a JSON array
//   fees: Uint256[]    each pool's fee tier, in millionths, one fewer than `tokens`: [100, 3000] is
//                      0.01% then 0.3%
//   exactOut: bool     false sells exactly `amount`; true buys exactly `amount`
//   amount: Uint256    the amount sold (of the first token) or bought (of the last), in its smallest
//                      units: 1000000000000000000000 is 1,000 DAI (18 decimals)
//   limit: Uint256     selling, the least of the last token to receive; buying, the most of the
//                      first token to pay; in that token's smallest units
//   recipient: Address who receives the last token
//
// On Ethereum, 1,000 DAI sold for WETH through USDC (DAI/USDC 0.01%, USDC/WETH 0.3%), for at least
// 0.25 WETH:
//
//   sauce run swap-path.sauce.ts --chain ethereum --keystore <keystore> \
//     --args '["0x6B175474E89094C44Da98b954EedeAC495271d0F","0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]' \
//     '[100,3000]' false 1000000000000000000000 250000000000000000 <recipient>
function main(
  tokens: Address[],
  fees: Uint256[],
  exactOut: bool,
  amount: Uint256,
  limit: Uint256,
  recipient: Address,
): { paid: Uint256; received: Uint256 } {
  const hops = fees.length;
  require(hops > 0 && tokens.length == hops + 1, "give one fee per pair of tokens");
  const tokenIn = tokens[0];
  const tokenOut = tokens[hops];

  // The path, token, fee, token, …: from the token paid for an exact input, from the token bought
  // for an exact output.
  let path = exactOut ? tokenOut.toBytesBe(20) : tokenIn.toBytesBe(20);
  for (let i = 0; i < hops; i++) {
    if (exactOut) {
      path = path.concat(fees[hops - 1 - i].toBytesBe(3), tokens[hops - 1 - i].toBytesBe(20));
    } else {
      path = path.concat(fees[i].toBytesBe(3), tokens[i + 1].toBytesBe(20));
    }
  }

  const received = Token(tokenOut).balanceOf(recipient);
  if (exactOut) {
    require(Token(tokenIn).balanceOf(pot) >= limit, "limit is not in the Pot");
    Token(tokenIn).approve(UniswapV3.SwapRouter, limit);
    const paid = UniswapV3.SwapRouter.exactOutput({
      path,
      recipient,
      deadline: ctx.timestamp(),
      amountOut: amount,
      amountInMaximum: limit,
    });
    Token(tokenIn).approve(UniswapV3.SwapRouter, 0);
    return { paid, received: Token(tokenOut).balanceOf(recipient) - received };
  }
  require(Token(tokenIn).balanceOf(pot) >= amount, "amount is not in the Pot");
  Token(tokenIn).approve(UniswapV3.SwapRouter, amount);
  UniswapV3.SwapRouter.exactInput({
    path,
    recipient,
    deadline: ctx.timestamp(),
    amountIn: amount,
    amountOutMinimum: limit,
  });
  return { paid: amount, received: Token(tokenOut).balanceOf(recipient) - received };
}
