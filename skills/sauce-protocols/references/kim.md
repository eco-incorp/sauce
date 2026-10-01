# Kim

Mode-native DEX. Its V2 router is a Camelot fork: swaps take a plain token path and a referrer, and support fee-on-transfer tokens. The primary trading venue on Mode Network with farming incentives.

## Category

dex | Chains: Mode

## Key Operations

- **swap**: Swap tokens along a token path

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/kim";
```

## SauceScript Examples

### swap

```typescript
import { KimRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amountIn,
    amountOutMin,
    [tokenIn, tokenOut],
    recipient,
    0x0000000000000000000000000000000000000000,
    99999999999,
  );
  return 1;
}
```

- `routerAddress`: Kim Router on Mode (`0x5D61c537393cf21893BE619E36fC94cd73C77DD3`)
- `tokenIn` / `tokenOut`: Input and output token addresses; a longer path swaps through intermediate tokens
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- The swap returns nothing: measure the output as the recipient's balance change

## Key Addresses

| Chain | Contract  | Address                                      |
| ----- | --------- | -------------------------------------------- |
| Mode  | V2 Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` |

## ABI Methods

### KimRouterABI

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)` - Swap along a token path. `referrer` may be the zero address
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a pair

## Notes

- Mode-only deployment; the dominant DEX on Mode Network
- Mode Network features native yield sharing via Sequencer Fee Sharing (SFS)
- LP tokens can be staked for farming rewards
- Input token must be ERC20-approved to the Router
