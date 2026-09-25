# Trader Joe

Liquidity Book DEX with variable-width bins for concentrated liquidity. Uses discrete price bins instead of continuous curves, allowing LPs to concentrate liquidity at specific price points. Native to Avalanche with expansion to Arbitrum and BSC.

## Category

dex | Chains: Avalanche, Arbitrum, BSC

## Key Operations

- **swap**: Swap exact input tokens via Liquidity Book path routing

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/trader-joe";
```

## SauceScript Examples

### swap

```typescript
import { LBRouterABI as ILBRouter } from "./abis";

function main(
  routerAddress: Address,
  path: { pairBinSteps: Uint256[]; versions: Uint256[]; tokenPath: Address[] },
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ILBRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
```

- `routerAddress`: Liquidity Book Router address for the target chain
- `path`: A **tuple** (NOT a simple address array) containing `{pairBinSteps: uint256[], versions: uint8[], tokenPath: address[]}`
  - `pairBinSteps`: Array of bin step sizes for each hop (determines price granularity per pair)
  - `versions`: Array of pool versions per hop (1=V1, 2=V2, 2.1=V2.1)
  - `tokenPath`: Ordered array of token addresses
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

## Key Addresses

| Chain     | Contract   | Address                                      |
| --------- | ---------- | -------------------------------------------- |
| Avalanche | LB Factory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` |
| Avalanche | LB Router  | `0x18556DA13313f3532c54711497A8FedAC273220E` |
| Arbitrum  | LB Router  | `0x18556da13313f3532c54711497a8fedac273220e` |
| BSC       | LB Router  | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` |

## ABI Methods

### LBRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) -> uint256 amountOut` - Swap exact input through LB path
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) -> uint256 amountIn` - Swap to get exact output
- `addLiquidity(tuple(address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline)) -> (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)` - Add liquidity with precise bin distribution control

### LBFactoryABI

- `getLBPairInformation(address tokenA, address tokenB, uint256 binStep) -> tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting)` - Look up LB pair info for a token pair and bin step (view)

## Notes

- Path is a **structured tuple** `{pairBinSteps, versions, tokenPath}`, NOT a simple address array like Uniswap V2
- Bin steps define price granularity: smaller bin steps = finer price precision but more gas, larger = coarser but cheaper
- Common bin steps: 1, 2, 5, 10, 15, 20, 25 basis points
- `addLiquidity` is complex: specify distribution across bins using `deltaIds` (relative bin offsets from active bin), `distributionX` and `distributionY` (percentage allocations per bin)
- `activeIdDesired`: The bin ID you expect to be active; `idSlippage`: max deviation from desired active ID
- Each LB pair is uniquely identified by (tokenX, tokenY, binStep)
- Trader Joe is the dominant DEX on Avalanche; use it for AVAX pairs and Avalanche ecosystem tokens
- Input token must be ERC20-approved to the LB Router
