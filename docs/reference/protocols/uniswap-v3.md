<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V3 (`uniswap-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Uniswap V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency. Supports multiple fee tiers per pair and NFT-based liquidity positions.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV3` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |

## When to use it

- Concentrated-liquidity pools in fee tiers of 0.01%, 0.05%, 0.3% and 1% (`100`, `500`,
  `3000`, `10000`).
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

## What it offers

- **swap**: Swap tokens using exact input (single-hop or multi-hop via encoded path)
- **addLiquidity**: Mint a new concentrated liquidity position as an NFT within a tick range
- **removeLiquidity**: Decrease liquidity from an existing NFT position

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
| [Optimism](../chains/optimism.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Optimism](../chains/optimism.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Optimism](../chains/optimism.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [BNB Chain](../chains/bsc.md) | factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `UniswapV3.Factory` |
| [BNB Chain](../chains/bsc.md) | nonfungiblePositionManager | `0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613` | `UniswapV3.NonfungiblePositionManager` |
| [BNB Chain](../chains/bsc.md) | quoterV2 | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` | `UniswapV3.QuoterV2` |
| [BNB Chain](../chains/bsc.md) | swapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `UniswapV3.SwapRouter02` |
| [Polygon](../chains/polygon.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Polygon](../chains/polygon.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Polygon](../chains/polygon.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Polygon](../chains/polygon.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Polygon](../chains/polygon.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Monad](../chains/monad.md) | factory | `0x204FAca1764B154221e35c0d20aBb3c525710498` | `UniswapV3.Factory` |
| [Monad](../chains/monad.md) | nonfungiblePositionManager | `0x7197E214c0b767cFB76Fb734ab638E2c192F4E53` | `UniswapV3.NonfungiblePositionManager` |
| [Monad](../chains/monad.md) | quoterV2 | `0x661E93cca42AfacB172121EF892830cA3b70F08d` | `UniswapV3.QuoterV2` |
| [Monad](../chains/monad.md) | swapRouter02 | `0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900` | `UniswapV3.SwapRouter02` |
| [Arc](../chains/arc.md) | factory | `0xf0db7b58379503491d857dB50AC9ece64c653918` | `UniswapV3.Factory` |
| [Arc](../chains/arc.md) | nonfungiblePositionManager | `0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377` | `UniswapV3.NonfungiblePositionManager` |
| [Arc](../chains/arc.md) | quoterV2 | `0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468` | `UniswapV3.QuoterV2` |
| [Arc](../chains/arc.md) | swapRouter02 | `0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77` | `UniswapV3.SwapRouter02` |
| [Base](../chains/base.md) | factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `UniswapV3.Factory` |
| [Base](../chains/base.md) | nonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | `UniswapV3.NonfungiblePositionManager` |
| [Base](../chains/base.md) | quoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | `UniswapV3.QuoterV2` |
| [Base](../chains/base.md) | swapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | `UniswapV3.SwapRouter02` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Arbitrum One](../chains/arbitrum.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Arbitrum One](../chains/arbitrum.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Arbitrum One](../chains/arbitrum.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Celo](../chains/celo.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Celo](../chains/celo.md) | nonfungiblePositionManager | `0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A` | `UniswapV3.NonfungiblePositionManager` |
| [Celo](../chains/celo.md) | quoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` | `UniswapV3.QuoterV2` |
| [Celo](../chains/celo.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` | `UniswapV3.Factory` |
| [Avalanche C-Chain](../chains/avalanche.md) | nonfungiblePositionManager | `0x655C406EBFa14EE2006250925e54ec43AD184f8B` | `UniswapV3.NonfungiblePositionManager` |
| [Avalanche C-Chain](../chains/avalanche.md) | quoterV2 | `0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F` | `UniswapV3.QuoterV2` |
| [Avalanche C-Chain](../chains/avalanche.md) | swapRouter02 | `0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE` | `UniswapV3.SwapRouter02` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UniswapV3FactoryABI`

`import UniswapV3FactoryABI from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `UniswapV3.Pool`
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
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
