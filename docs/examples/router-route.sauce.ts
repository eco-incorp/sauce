import { balancerV2, curve, uniswapV2, uniswapV3 } from "@sauce/router";

// One compiled program for any route over four venues: each leg names its venue, pool and tokens,
// and the program picks the function while it runs, spending what the previous leg returned.
interface Leg {
  venue: Uint256; // 0 Uniswap V2, 1 Uniswap V3, 3 Curve, 4 Balancer V2; any other reverts
  pool: Address; // the pair, the pool, or the Balancer Vault
  tokenIn: Address;
  tokenOut: Address;
  i: Uint256; // Curve's coin indices, in a StableSwap (int128) pool
  j: Uint256;
  poolId: Uint256; // Balancer's pool id
}

function main(legs: Leg[], amountIn: Uint256, minOut: Uint256): Uint256 {
  let out = amountIn;
  for (let k = 0; k < legs.length; k = k + 1) {
    const leg = legs[k];
    if (leg.venue == 0) {
      out = uniswapV2(leg.pool, leg.tokenIn, leg.tokenOut, out, 0, 0, ctx.self());
    } else if (leg.venue == 1) {
      out = uniswapV3(leg.pool, leg.tokenIn, leg.tokenOut, out, 0, 0, ctx.self());
    } else if (leg.venue == 3) {
      out = curve(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.i, leg.j, false, 0, ctx.self());
    } else if (leg.venue == 4) {
      out = balancerV2(leg.pool, leg.tokenIn, leg.tokenOut, out, leg.poolId, 0, ctx.self());
    } else {
      throw "router-route: unknown venue";
    }
  }
  require(out >= minOut);
  return out;
}
