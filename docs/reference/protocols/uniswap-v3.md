<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V3 (`uniswap-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Uniswap V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency. Supports multiple fee tiers per pair and NFT-based liquidity positions.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV3` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |

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
  ([the `@sauce/router` reference](../../api/router.md)).
- Uniswap's own SwapRouter takes a `deadline` in its params; SwapRouter02 does not.

## In a Sauce program

One guarded swap on the 0.05% WETH/USDC pool:

```ts
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
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. With `@sauce/router`'s `uniswapV3`, set a real limit ([the `@sauce/router` reference](../../api/router.md))

### addLiquidity (mint position)

```typescript
import { UniswapV3NonfungiblePositionManagerABI as INonfungiblePositionManager } from "./abis";

function main(
  nfpmAddress: Address,
  token0: Address,
  token1: Address,
  fee: Uint256,
  tickLower: Uint256,
  tickUpper: Uint256,
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
- `tickLower` / `tickUpper`: Price range boundaries as tick values. Ticks must be multiples of the pool's tick spacing (10 for 0.05%, 60 for 0.3%, 200 for 1%)
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

## Its names in a program

On Ethereum, `UniswapV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0x1F98431c8aD98523631AE4a59f267346ea31F984`.
  require(UniswapV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Ethereum](../chains/ethereum.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Ethereum](../chains/ethereum.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Ethereum](../chains/ethereum.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Ethereum](../chains/ethereum.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Optimism](../chains/optimism.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Optimism](../chains/optimism.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Optimism](../chains/optimism.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [BNB Chain](../chains/bsc.md) | factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `UniswapV3.Factory` |
| [BNB Chain](../chains/bsc.md) | swapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `UniswapV3.SwapRouter02` |
| [Polygon](../chains/polygon.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Polygon](../chains/polygon.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Polygon](../chains/polygon.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Monad](../chains/monad.md) | factory | `0x204faca1764b154221e35c0d20abb3c525710498` | `UniswapV3.Factory` |
| [Monad](../chains/monad.md) | nonfungiblePositionManager | `0x7197e214c0b767cfb76fb734ab638e2c192f4e53` | `UniswapV3.NonfungiblePositionManager` |
| [Monad](../chains/monad.md) | quoterV2 | `0x661e93cca42afacb172121ef892830ca3b70f08d` | `UniswapV3.QuoterV2` |
| [Monad](../chains/monad.md) | swapRouter02 | `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900` | `UniswapV3.SwapRouter02` |
| [Arc](../chains/arc.md) | factory | `0xf0db7b58379503491d857dB50AC9ece64c653918` | `UniswapV3.Factory` |
| [Arc](../chains/arc.md) | nonfungiblePositionManager | `0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377` | `UniswapV3.NonfungiblePositionManager` |
| [Arc](../chains/arc.md) | quoterV2 | `0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468` | `UniswapV3.QuoterV2` |
| [Arc](../chains/arc.md) | swapRouter02 | `0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77` | `UniswapV3.SwapRouter02` |
| [Base](../chains/base.md) | factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `UniswapV3.Factory` |
| [Base](../chains/base.md) | nonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | `UniswapV3.NonfungiblePositionManager` |
| [Base](../chains/base.md) | swapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | `UniswapV3.SwapRouter02` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Arbitrum One](../chains/arbitrum.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Celo](../chains/celo.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Celo](../chains/celo.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` | `UniswapV3.Factory` |
| [Avalanche C-Chain](../chains/avalanche.md) | swapRouter02 | `0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE` | `UniswapV3.SwapRouter02` |

## ABI

### `UniswapV3FactoryABI`

`import UniswapV3FactoryABI from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`
- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`

### `UniswapV3NonfungiblePositionManagerABI`

`import UniswapV3NonfungiblePositionManagerABI from "./protocols/uniswap-v3/UniswapV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`

### `UniswapV3PoolABI`

`import UniswapV3PoolABI from "./protocols/uniswap-v3/UniswapV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `UniswapV3QuoterV2ABI`

`import UniswapV3QuoterV2ABI from "./protocols/uniswap-v3/UniswapV3QuoterV2ABI.json";` Speaks for: quoterV2.

- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`

### `UniswapV3SwapRouter02ABI`

`import UniswapV3SwapRouter02ABI from "./protocols/uniswap-v3/UniswapV3SwapRouter02ABI.json";` Speaks for: swapRouter02.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`

### `UniswapV3SwapRouterABI`

`import UniswapV3SwapRouterABI from "./protocols/uniswap-v3/UniswapV3SwapRouterABI.json";` Speaks for: swapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
