# Uniswap V3

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency. Supports multiple fee tiers per pair and NFT-based liquidity positions.

## When to use it

- Concentrated-liquidity pools in fee tiers of 0.01%, 0.05%, 0.3% and 1% (`100`, `500`,
  `3000`, `10000`): usually the deepest pools for liquid pairs.
- A Sauce program swaps a pool with `@sauce/router`'s `uniswapV3`, with a price limit; the
  Factory finds the pool, the position manager manages liquidity positions.

## Pitfalls for a program

- A pool pays out first and then calls back for its input, which a program cannot answer:
  `uniswapV3` calls the Pot's Router, which pays that callback from the Pot, so do not call
  `pool.swap` yourself.
- Each fee tier is a separate pool, with its own price and depth.
- The price limit bounds the pool's price, not the price paid: the fee comes on top
  (`sauce-swaps`).
- Uniswap's own SwapRouter takes a `deadline` in its params; SwapRouter02 does not.

## In a Sauce program

One guarded swap on the 0.05% WETH/USDC pool:

```sauce chain=base,arbitrum
import { uniswapV3 } from "@sauce/router";

function main(amountIn: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address) {
  const self = ctx.self();
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC pool at 0.05%");
  require(UniswapV3.Pool(pool).liquidity() > 0, "the pool has no liquidity");
  const before = WETH.balanceOf(self);
  uniswapV3(pool, WETH, USDC, amountIn, sqrtPriceLimitX96, minOut, recipient);
  const unspent = amountIn - (before - WETH.balanceOf(self));
  if (unspent > 0) {
    WETH.transfer(recipient, unspent);
  }
}
```

`uniswapV3` pays `recipient` and reverts below `minOut`. The pool stops at the price limit, so
the WETH it did not take goes back to `recipient` too: `amountIn` less what the swap spent, not
the Pot's whole WETH balance.

## Category

dex | Chains and addresses: [registry/uniswap-v3.md](registry/uniswap-v3.md)

## Key Operations

- **swap**: Swap tokens using exact input (single-hop or multi-hop via encoded path)
- **addLiquidity**: Mint a new concentrated liquidity position as an NFT within a tick range
- **removeLiquidity**: Decrease liquidity from an existing NFT position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { UniswapV3SwapRouterABI as ISwapRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- `routerAddress`: Uniswap V3 SwapRouter address for the target chain. This `swap` uses SwapRouter's params (with `deadline`); chains that only have SwapRouter02 (Base, BSC, Avalanche, Celo, Monad) need `UniswapV3SwapRouter02ABI`, whose params have no `deadline`
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier in hundredths of a bip. Common values: `500` (0.05%), `3000` (0.3%), `10000` (1%)
- `amountIn`: Exact amount of input token (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. With `@sauce/router`'s `uniswapV3`, set a real limit (`sauce-swaps`)

### addLiquidity (mint position)

```typescript
import { UniswapV3NonfungiblePositionManagerABI as INonfungiblePositionManager } from "./abis";

function main(
  nfpmAddress: Address,
  token0: Address,
  token1: Address,
  fee: Uint256,
  tickLower: Int256,
  tickUpper: Int256,
  amount0Desired: Uint256,
  amount1Desired: Uint256,
  amount0Min: Uint256,
  amount1Min: Uint256,
  recipient: Address,
): { tokenId: Uint256; liquidity: Uint256; amount0: Uint256; amount1: Uint256 } {
  const nfpm = INonfungiblePositionManager.at(nfpmAddress);
  return nfpm.mint({
    token0: token0,
    token1: token1,
    fee: fee,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: amount0Min,
    amount1Min: amount1Min,
    recipient: recipient,
    deadline: 99999999999,
  });
}
```

- `nfpmAddress`: NonfungiblePositionManager contract address
- `token0` / `token1`: Pair tokens sorted by address (token0 < token1)
- `fee`: Pool fee tier (500, 3000, or 10000)
- `tickLower` / `tickUpper`: Price range boundaries as signed tick values, `Int256`: a negative tick is an ordinary negative number such as `-60`, never a two's-complement word. They reach the position manager's ABI `int24` parameters through a checked conversion, so each must fit -8388608 through 8388607, and the pool accepts only ticks from -887272 through 887272, with `tickLower` below `tickUpper`. Ticks must be multiples of the pool's tick spacing (10 for 0.05%, 60 for 0.3%, 200 for 1%)
- `amount0Desired` / `amount1Desired`: Target deposit amounts
- `amount0Min` / `amount1Min`: Minimum deposit amounts (slippage protection)
- Both tokens must be approved to the NonfungiblePositionManager

### removeLiquidity (decrease liquidity)

```typescript
import { UniswapV3NonfungiblePositionManagerABI as INonfungiblePositionManager } from "./abis";

function main(
  nfpmAddress: Address,
  tokenId: Uint256,
  liquidity: Uint256,
  amount0Min: Uint256,
  amount1Min: Uint256,
): { amount0: Uint256; amount1: Uint256 } {
  const nfpm = INonfungiblePositionManager.at(nfpmAddress);
  return nfpm.decreaseLiquidity({
    tokenId: tokenId,
    liquidity: liquidity,
    amount0Min: amount0Min,
    amount1Min: amount1Min,
    deadline: 99999999999,
  });
}
```

- `tokenId`: NFT ID of the liquidity position
- `liquidity`: Amount of liquidity to remove (not token amounts)
- `amount0Min` / `amount1Min`: Minimum tokens to receive (slippage protection)
- After decreasing liquidity, call `collect` to actually withdraw the tokens

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/uniswap-v3.md](registry/uniswap-v3.md).

## Notes

- Fee tiers: `100` (0.01%, stablecoins), `500` (0.05%, correlated pairs), `3000` (0.3%, standard), `10000` (1%, exotic)
- Token order matters: `token0` must be the lower address. Sort before calling mint
- Tick spacing varies by fee tier: 1 (0.01%), 10 (0.05%), 60 (0.3%), 200 (1%)
- After `decreaseLiquidity`, tokens sit in the position until `collect` is called
- For multi-hop swaps via `exactInput`, the `path` is ABI-encoded as `tokenIn + fee + tokenMiddle + fee + tokenOut`
- Input token must be ERC20-approved to the SwapRouter for swaps
- Both tokens must be ERC20-approved to the NFPM for minting positions
- Prefer V3 over V2 for major pairs to benefit from concentrated liquidity and lower effective slippage
- From a Pot program, `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` swaps one pool through the Pot's Sauce Router, which answers the pool's callback from the Pot — no SwapRouter and no approval — checks the pool's tokens, sends `amountIn` as positive exact input, and returns the amount out. A path is one call per pool, each spending the last one's output. The `uniswapV3Swap` action is the same call
- On Arc (5042) `WETH9()` on SwapRouter02 and the position manager is a stub that always reverts with `UnsupportedProtocolError()`, so `unwrapWETH9`, `refundETH` and native-value swaps revert. Trade USDC's ERC-20 `0x3600000000000000000000000000000000000000`; Arc's native coin is USDC and it has no canonical wrapped native
- SwapRouter02's params structs drop `deadline` (wrap the call in a deadline check if needed).
