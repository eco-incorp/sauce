// Uniswap's flash example, ported: `PairFlash` borrows from one Uniswap V3 pool, trades the loan
// through the pair's other pools, repays the loan with its fee and pays what is left to the caller.
// Here the loan is a flash swap: `amountIn` of `tokenIn` is sold in the `borrowFee` pool, and its
// `tokenOut` is in the Pot before anything is paid; a program then sells that `tokenOut` back in the
// `repayFee` pool for at least `amountIn`; the borrow pool is paid `amountIn` out of it, and the rest
// is the profit, sent to `payer` and returned. Nothing the Pot already held is spent: a trade that
// cannot repay reverts the whole transaction, as PairFlash's does.
//
// Ported from Uniswap/v3-periphery, contracts/examples/PairFlash.sol (149 lines, 109 of code):
// https://github.com/Uniswap/v3-periphery/blob/0411d43779d01f4e82cfc31aea00fd6011b3756d/contracts/examples/PairFlash.sol
//
// What changes in Sauce: a pool's `flash` pays the borrower and then calls it back
// (`uniswapV3FlashCallback`) to be repaid, and a Pot cannot be called back by a program: its fallback
// runs its Router. The Router's `flash(callback, swap)` is Sauce's flash: it runs one swap, whose
// pool sends the output first, runs `callback` inside the pool's callback, and pays the pool after
// it. `program()` compiles the callback, a closure that reads the program's own values, and
// SauceRouterFlash.json beside this file declares `flash`. So the loan is one token, sold rather
// than lent, and its fee is the borrow pool's swap fee; PairFlash's second loan and third pool are
// the same trade the other way round.
//
//   sauce run uniswap-v3-pair-flash.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <borrowFee> <amountIn> <repayFee> <payer>
//
//   tokenIn: Address      the token the borrow pool is paid in, after the callback
//   tokenOut: Address     the token the borrow pool sends first
//   borrowFee: Uint256    the borrow pool's fee tier, in millionths: 500 is 0.05%
//   amountIn: Uint256     how much `tokenIn` the borrow pool is paid, in its smallest units:
//                         1000000000000000000 is 1 WETH (18 decimals)
//   repayFee: Uint256     the fee tier of the pool the borrowed `tokenOut` is sold back in
//   payer: Address        who receives the profit, in `tokenIn`
//
// On Ethereum, 1 WETH's worth of USDC borrowed from the 0.05% pool and sold back for WETH in the
// 0.3% pool:
//
//   sauce run uniswap-v3-pair-flash.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
//     500 1000000000000000000 3000 <payer>
import { uniswapV3 } from "@sauce/router";
import SauceRouterFlash from "./SauceRouterFlash.json";

function main(
  tokenIn: Address,
  tokenOut: Address,
  borrowFee: Uint256,
  amountIn: Uint256,
  repayFee: Uint256,
  payer: Address,
): Uint256 {
  require(UniswapV3.Factory);
  const borrowPool = UniswapV3.Factory.getPool(tokenIn, tokenOut, borrowFee);
  const repayPool = UniswapV3.Factory.getPool(tokenIn, tokenOut, repayFee);
  require(borrowPool != 0 && repayPool != 0, "no pool at those fee tiers");
  const inBefore = Token(tokenIn).balanceOf(pot);
  const outBefore = Token(tokenOut).balanceOf(pot);

  // The callback: the borrow pool has sent `tokenOut` and is not paid yet. Sell what it sent back
  // for at least what it is owed, into the Pot, which pays it.
  const repay = program(() => {
    const received = Token(tokenOut).balanceOf(pot) - outBefore;
    uniswapV3(repayPool, tokenOut, tokenIn, received, 0, amountIn, pot);
  });
  // The swap the Router runs around it, as the calldata of its own `swapV3`.
  const swapV3 = (crypto.keccak256("swapV3(address,address,bool,uint256,uint160,address)") >> 224)
    .toBytesBe(4)
    .concat(abi.encode(borrowPool, tokenIn, tokenIn < tokenOut, amountIn, 0, pot));
  SauceRouterFlash.at(pot).flash(repay.code.concat(repay.args), swapV3);

  // What the repayment left of `tokenIn`, beyond what the Pot held: the profit.
  const profit = Token(tokenIn).balanceOf(pot) - inBefore;
  if (profit > 0) {
    Token(tokenIn).transfer(payer, profit);
  }
  return profit;
}
