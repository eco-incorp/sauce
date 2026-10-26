// Uniswap's V4 swap guide, ported: its `Example` contract approves the Universal Router through
// Permit2, then sells `amountIn` of a V4 pool's `currency0` for its `currency1` with one `V4_SWAP`
// command: a single-pool exact-input swap, its input settled and its output taken. It returns the
// `currency1` the swap delivered, and fails below `minAmountOut`.
//
// Ported from Uniswap/docs, content/protocols/v4/guides/swapping/swapping.mdx (79 lines, 61 of code):
// https://github.com/Uniswap/docs/blob/338d70983ac49911aecac02dd57b0a969c1ca61e/content/protocols/v4/guides/swapping/swapping.mdx
//
// What changes in Sauce: the contract was deployed with the router's, the pool manager's and
// Permit2's addresses; the program names them `UniswapV4.UniversalRouter` and `Permit2.Permit2`.
// The guide's two functions run in one cook, `approveTokenWithPermit2` first: it approved Permit2
// for the maximum, and the program approves Permit2 for `amountIn` alone. Its output was the
// contract's whole balance of `currency1`; the program measures what the swap added. The guide's
// count is its contract: its setup, its approval and its complete swap function.
//
//   sauce run uniswap-v4-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <key> <amountIn> <minAmountOut>
//
//   key: { currency0: Address, currency1: Address, fee: Uint256, tickSpacing: Uint256, hooks: Address }
//                           the pool, as V4 keys it: its two tokens in address order, its fee in
//                           millionths, its tick spacing and its hooks (0 for none)
//   amountIn: Uint256       the `currency0` to sell, in its smallest units: 1000000000 is 1,000 USDC
//   minAmountOut: Uint256   the least `currency1` to accept, in its smallest units
//
// On Ethereum, 1,000 USDC sold for at least 0.25 WETH in the 0.05% USDC/WETH pool, which has no
// hooks:
//
//   sauce run uniswap-v4-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --args '{"currency0":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","currency1":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","fee":500,"tickSpacing":10,"hooks":"0x0000000000000000000000000000000000000000"}' \
//     1000000000 250000000000000000

// The Universal Router's command, and the V4 router's actions, as the libraries number them.
const V4_SWAP = hex`10`;
const SWAP_EXACT_IN_SINGLE = hex`06`;
const SETTLE_ALL = hex`0c`;
const TAKE_ALL = hex`0f`;

interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: Uint256;
  tickSpacing: Uint256;
  hooks: Address;
}

function approveTokenWithPermit2(token: Address, amount: Uint256, expiration: Uint256): void {
  require(Permit2.Permit2 && UniswapV4.UniversalRouter);
  approve(token, Permit2.Permit2, amount);
  Permit2.Permit2.approve(token, UniswapV4.UniversalRouter, amount, expiration);
}

function swapExactInputSingle(key: PoolKey, amountIn: Uint256, minAmountOut: Uint256): Uint256 {
  require(UniswapV4.UniversalRouter);
  const actions = SWAP_EXACT_IN_SINGLE.concat(SETTLE_ALL, TAKE_ALL);
  // Solidity encodes one struct that holds bytes as one value, behind an offset; `abi.encode`
  // encodes a record as its fields, so the struct goes in a record of its own.
  const params = [
    abi.encode({
      exactInputSingle: {
        poolKey: key,
        zeroForOne: true,
        amountIn,
        amountOutMinimum: minAmountOut,
        hookData: hex``,
      },
    }),
    abi.encode(key.currency0, amountIn),
    abi.encode(key.currency1, minAmountOut),
  ];
  const before = Token(key.currency1).balanceOf(pot);
  UniswapV4.UniversalRouter.execute(V4_SWAP, [abi.encode(actions, params)], ctx.timestamp() + 20);
  const amountOut = Token(key.currency1).balanceOf(pot) - before;
  require(amountOut >= minAmountOut, "Insufficient output amount");
  return amountOut;
}

function main(key: PoolKey, amountIn: Uint256, minAmountOut: Uint256): Uint256 {
  approveTokenWithPermit2(key.currency0, amountIn, ctx.timestamp());
  return swapExactInputSingle(key, amountIn, minAmountOut);
}
