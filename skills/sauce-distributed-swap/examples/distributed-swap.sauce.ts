// A limit order spread over the chain's Uniswap V3 pools: sells up to `amountIn` of `tokenIn` for
// `tokenOut`, every unit at `sqrtPriceLimitX96` or better with the pool's fee paid, and sends the
// output to `recipient` and the unsold input back to the Pot's owner.
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --fund <token>:<amount> \
//     --args <tokenIn> <tokenOut> <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
//
//   tokenIn            Address  the token sold; `--fund` pulls it from the signer into the Pot
//   tokenOut           Address  the token bought
//   amountIn           Uint256  tokenIn's smallest units: 1000000000000000000 is 1 WETH
//   sqrtPriceLimitX96  Uint256  the worst price, as a pool's sqrt price: `sauce price --chain <chain>
//                               WETH USDC 2686.5` prints it (`sell` selling WETH, `buy` buying it),
//                               or floor(sqrt(token1 units per token0 unit) * 2^96), token0 the
//                               lower address
//   minOut             Uint256  the least tokenOut in its smallest units, or 0: 2686500000 is
//                               2,686.5 USDC
//   recipient          Address  who receives tokenOut
//
//   Selling 1 WETH on Base at 2,686.5 USDC per WETH or better, all of it or nothing:
//   sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
//     --keystore <keystore> --fund WETH:1 \
//     --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
//     1000000000000000000 4106511148422261116904015 2686500000 <recipient>
import { uniswapV3 } from "@sauce/router";

function main(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
) {
  const self = ctx.self();
  const input = Token(tokenIn);
  const sellsToken0 = tokenIn < tokenOut; // selling token0 pushes the price down, token1 up
  let unsold = amountIn;
  let bought = 0n;

  // Lowest fee first. Every pool stops at its own limit, so any order keeps every fill within it.
  for (const fee of [100n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
    if (unsold > 0n && pool != 0n) {
      const [inRange] = abi.decode(evm.static(pool, hex`1a686502`), ["Uint256"]); // liquidity()
      const [price] = abi.decode(evm.static(pool, hex`3850c7bd`), ["Uint256"]); // slot0()'s first word
      // A pool's limit is on its price before the fee: move it toward the trade by √(1 − fee), so
      // its last unit, fee paid, costs exactly the caller's limit.
      const root = Math.sqrt((1000000n - fee) * 1000000n); // √(1 − fee), in millionths
      const limit = sellsToken0
        ? Math.mulDiv(sqrtPriceLimitX96, 1000000n, root)
        : Math.mulDiv(sqrtPriceLimitX96, root, 1000000n);
      if (inRange > 0n && (sellsToken0 ? price > limit : price < limit)) {
        const before = input.balanceOf(self);
        bought += uniswapV3(pool, tokenIn, tokenOut, unsold, limit, 0n, recipient);
        unsold -= before - input.balanceOf(self); // the Router paid only what the pool used
      }
    }
  }

  require(bought >= minOut, "output below minOut");
  if (unsold > 0n) {
    input.transfer(ctx.msgSender(), unsold); // to the Pot's owner, who sent the cook
  }
}
