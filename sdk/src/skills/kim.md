# Kim

Mode-native DEX with Solidly-style routing supporting both stable and volatile pool types. The primary trading venue on Mode Network with farming incentives.

## Category

dex | Chains: Mode

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/kim";
```

## SauceScript Examples

### swap

```typescript
import { KimRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  stable: bool,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [{ from: tokenIn, to: tokenOut, stable: stable }],
    recipient,
    99999999999,
  );
}
```

- `routerAddress`: Kim Router on Mode (`0x5D61c537393cf21893BE619E36fC94cd73C77DD3`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Kim routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Key Addresses

| Chain | Contract  | Address                                      |
| ----- | --------- | -------------------------------------------- |
| Mode  | V2 Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` |

## ABI Methods

### KimRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- Mode-only deployment; the dominant DEX on Mode Network
- Mode Network features native yield sharing via Sequencer Fee Sharing (SFS)
- LP tokens can be staked for farming rewards
- Input token must be ERC20-approved to the Router
