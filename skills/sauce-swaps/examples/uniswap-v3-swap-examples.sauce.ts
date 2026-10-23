// Uniswap's swap examples, ported: the four swaps of the `SwapExamples` contract in Uniswap's V3
// guides, through the chain's Uniswap V3 SwapRouter, as one program. `multihop` picks the route,
// DAI → WETH in the 0.3% pool or DAI → USDC → WETH; `exactOutput` picks the exact side, DAI sold
// or WETH bought. It returns what the router returns: the WETH bought, or with
// `exactOutput` the DAI spent.
//
// Ported from Uniswap/docs, content/examples/smart-contracts/SwapExamples.sol (163 lines, 80 of code):
// https://github.com/Uniswap/docs/blob/338d70983ac49911aecac02dd57b0a969c1ca61e/content/examples/smart-contracts/SwapExamples.sol
//
// What changes in Sauce: the contract pulled DAI from its caller and was deployed with the router's
// address; the program spends the Pot's DAI (send it to the Pot first) and names the router
// `UniswapV3.SwapRouter` and DAI `Maker.Dai`, the registry's names for them. Each Solidity function
// is a function here, with `msg.sender` as `recipient`. The original passes `amountOutMinimum: 0`
// and says to choose a safer value in production: `limit` is that value. It also takes both hops
// through 0.3% pools; DAI and USDC trade in the 0.01% pool now (the 0.3% one turns 1,000 DAI into
// about 116 USDC), so the path takes that hop at 0.01%. DAI is not one of the `sauce` command's
// token symbols on Ethereum: `--fund` and `--assume-balance` take it by its address, which
// `sauce globals --chain ethereum --protocol Maker` prints as `Dai`.
//
//   sauce run uniswap-v3-swap-examples.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <multihop> <exactOutput> <amount> <limit> <recipient>
//
//   multihop: bool        false: DAI → WETH in one pool; true: DAI → USDC → WETH
//   exactOutput: bool     false: sell exactly `amount` DAI; true: buy exactly `amount` WETH
//   amount: Uint256       the DAI to sell, or the WETH to buy, in smallest units (18 decimals):
//                         1000000000000000000000 is 1,000 DAI
//   limit: Uint256        the least WETH to accept for `amount` DAI, or with `exactOutput` the most
//                         DAI to spend for `amount` WETH, in smallest units; what is not spent
//                         stays in the Pot
//   recipient: Address    who receives the WETH
//
// On Ethereum, 1,000 DAI sold for at least 0.25 WETH in the 0.3% pool:
//
//   sauce run uniswap-v3-swap-examples.sauce.ts --chain ethereum --keystore <keystore> \
//     --args false false 1000000000000000000000 250000000000000000 <recipient>

const POOL_FEE = 3000;
const STABLE_FEE = 100;

// A path the router reads: each token's 20 bytes, with the fee of the pool between two in 3.
function path(a: Address, feeAB: Uint256, b: Address, feeBC: Uint256, c: Address): bytes {
  return a
    .toBytesBe(20)
    .concat(feeAB.toBytesBe(3), b.toBytesBe(20), feeBC.toBytesBe(3), c.toBytesBe(20));
}

function swapExactInputSingle(amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  require(UniswapV3.SwapRouter && Maker.Dai);
  approve(Maker.Dai, UniswapV3.SwapRouter, amountIn);
  return UniswapV3.SwapRouter.exactInputSingle({
    tokenIn: Maker.Dai,
    tokenOut: WETH,
    fee: POOL_FEE,
    recipient,
    deadline: ctx.timestamp(),
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0,
  });
}

function swapExactOutputSingle(amountOut: Uint256, maxIn: Uint256, recipient: Address): Uint256 {
  require(UniswapV3.SwapRouter && Maker.Dai);
  approve(Maker.Dai, UniswapV3.SwapRouter, maxIn);
  const amountIn = UniswapV3.SwapRouter.exactOutputSingle({
    tokenIn: Maker.Dai,
    tokenOut: WETH,
    fee: POOL_FEE,
    recipient,
    deadline: ctx.timestamp(),
    amountOut,
    amountInMaximum: maxIn,
    sqrtPriceLimitX96: 0,
  });
  // The router took less than the maximum: withdraw the allowance it did not use, as the
  // original does. The DAI it did not take is still the Pot's.
  if (amountIn < maxIn) {
    approve(Maker.Dai, UniswapV3.SwapRouter, 0);
  }
  return amountIn;
}

function swapExactInputMultihop(amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  require(UniswapV3.SwapRouter && Maker.Dai);
  approve(Maker.Dai, UniswapV3.SwapRouter, amountIn);
  return UniswapV3.SwapRouter.exactInput({
    path: path(Maker.Dai, STABLE_FEE, USDC, POOL_FEE, WETH),
    recipient,
    deadline: ctx.timestamp(),
    amountIn,
    amountOutMinimum: minOut,
  });
}

function swapExactOutputMultihop(amountOut: Uint256, maxIn: Uint256, recipient: Address): Uint256 {
  require(UniswapV3.SwapRouter && Maker.Dai);
  approve(Maker.Dai, UniswapV3.SwapRouter, maxIn);
  // An exact-output path runs backwards, from the token bought to the token paid.
  const amountIn = UniswapV3.SwapRouter.exactOutput({
    path: path(WETH, POOL_FEE, USDC, STABLE_FEE, Maker.Dai),
    recipient,
    deadline: ctx.timestamp(),
    amountOut,
    amountInMaximum: maxIn,
  });
  if (amountIn < maxIn) {
    approve(Maker.Dai, UniswapV3.SwapRouter, 0);
  }
  return amountIn;
}

function main(
  multihop: bool,
  exactOutput: bool,
  amount: Uint256,
  limit: Uint256,
  recipient: Address,
): Uint256 {
  require(Maker.Dai);
  const spendable = balanceOf(Maker.Dai, ctx.self());
  require(spendable >= (exactOutput ? limit : amount), "the DAI to spend is not in the Pot");
  if (multihop) {
    return exactOutput
      ? swapExactOutputMultihop(amount, limit, recipient)
      : swapExactInputMultihop(amount, limit, recipient);
  }
  return exactOutput
    ? swapExactOutputSingle(amount, limit, recipient)
    : swapExactInputSingle(amount, limit, recipient);
}
