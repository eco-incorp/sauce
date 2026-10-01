# Uniswap V3

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency. Supports multiple fee tiers per pair and NFT-based liquidity positions.

## Category

dex | Chains and addresses: [registry/uniswap-v3.md](registry/uniswap-v3.md)

## Key Operations

- **swap**: Swap tokens using exact input (single-hop or multi-hop via encoded path)
- **addLiquidity**: Mint a new concentrated liquidity position as an NFT within a tick range
- **removeLiquidity**: Decrease liquidity from an existing NFT position

## SauceScript Examples

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
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. Through the Sauce Router, set a real limit (`sauce-swaps`)

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
- On Arc (5042) `WETH9()` on SwapRouter02 and the position manager is a stub that always reverts with `UnsupportedProtocolError()`, so `unwrapWETH9`, `refundETH` and native-value swaps revert. Trade USDC's ERC-20 `0x3600000000000000000000000000000000000000`; Arc's native coin is USDC and it has no canonical wrapped native
- SwapRouter02's params structs drop `deadline` (wrap the call in a deadline check if needed).
