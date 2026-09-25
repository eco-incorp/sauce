# Uniswap V3

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency. Supports multiple fee tiers per pair and NFT-based liquidity positions.

## Category

dex | Chains: Ethereum, Arbitrum, Optimism, Polygon, Base, BSC, Avalanche, Celo

## Key Operations

- **swap**: Swap tokens using exact input (single-hop or multi-hop via encoded path)
- **addLiquidity**: Mint a new concentrated liquidity position as an NFT within a tick range
- **removeLiquidity**: Decrease liquidity from an existing NFT position

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/uniswap-v3";
```

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

- `routerAddress`: Uniswap V3 SwapRouter address for the target chain
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier in hundredths of a bip. Common values: `500` (0.05%), `3000` (0.3%), `10000` (1%)
- `amountIn`: Exact amount of input token (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `sqrtPriceLimitX96`: Set to `0` to accept any price (no limit)

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

## Key Addresses

| Chain     | Contract     | Address                                      |
| --------- | ------------ | -------------------------------------------- |
| Ethereum  | Factory      | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Ethereum  | SwapRouter   | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Ethereum  | SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| Ethereum  | QuoterV2     | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |
| Ethereum  | NFPM         | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| Arbitrum  | Factory      | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Arbitrum  | SwapRouter   | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Arbitrum  | NFPM         | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| Optimism  | Factory      | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Optimism  | SwapRouter   | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Optimism  | NFPM         | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| Polygon   | Factory      | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Polygon   | SwapRouter   | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Polygon   | NFPM         | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` |
| Base      | Factory      | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| Base      | SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Base      | NFPM         | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| BSC       | Factory      | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` |
| BSC       | SwapRouter02 | `0xB971eF87ede563556b2ED4b1652CB9cc5aA6f`    |
| Avalanche | Factory      | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` |
| Avalanche | SwapRouter02 | `0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE` |
| Celo      | Factory      | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` |
| Celo      | SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |

## ABI Methods

### UniswapV3SwapRouterABI

- `exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) -> uint256 amountOut` - Single-hop swap with exact input amount
- `exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) -> uint256 amountOut` - Multi-hop swap with exact input via encoded path (tokenA+fee+tokenB+fee+tokenC)
- `exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) -> uint256 amountIn` - Single-hop swap specifying exact output desired
- `exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) -> uint256 amountIn` - Multi-hop swap specifying exact output desired

### UniswapV3NonfungiblePositionManagerABI

- `mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) -> (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)` - Create new liquidity position NFT
- `increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) -> (uint128 liquidity, uint256 amount0, uint256 amount1)` - Add more liquidity to existing position
- `decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) -> (uint256 amount0, uint256 amount1)` - Remove liquidity from position (tokens stay in contract until collected)
- `collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) -> (uint256 amount0, uint256 amount1)` - Withdraw accumulated fees and removed liquidity tokens

### UniswapV3FactoryABI

- `getPool(address tokenA, address tokenB, uint24 fee) -> address pool` - Look up pool address for token pair and fee tier (view)
- `createPool(address tokenA, address tokenB, uint24 fee) -> address pool` - Deploy a new pool

### UniswapV3QuoterV2ABI

- `quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) -> (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)` - Simulate a swap to get expected output (view)

## Notes

- Fee tiers: `100` (0.01%, stablecoins), `500` (0.05%, correlated pairs), `3000` (0.3%, standard), `10000` (1%, exotic)
- Token order matters: `token0` must be the lower address. Sort before calling mint
- Tick spacing varies by fee tier: 1 (0.01%), 10 (0.05%), 60 (0.3%), 200 (1%)
- After `decreaseLiquidity`, tokens sit in the position until `collect` is called
- For multi-hop swaps via `exactInput`, the `path` is ABI-encoded as `tokenIn + fee + tokenMiddle + fee + tokenOut`
- Input token must be ERC20-approved to the SwapRouter for swaps
- Both tokens must be ERC20-approved to the NFPM for minting positions
- Prefer V3 over V2 for major pairs to benefit from concentrated liquidity and lower effective slippage
