# Lynex

Linea-native ve(3,3) DEX and liquidity marketplace. Solidly-fork with gauge voting and support for both stable and volatile pool types on the Linea zkEVM network.

## Category

dex | Chains: Linea

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/lynex";
```

## SauceScript Examples

### swap

```typescript
import { LynexRouterABI as IRouter } from "./abis";

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

- `routerAddress`: Lynex Router on Linea (`0x610D2f07b7EdC67565160F587F37636194C34E74`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Lynex routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Key Addresses

| Chain | Contract | Address                                      |
| ----- | -------- | -------------------------------------------- |
| Linea | Router   | `0x610D2f07b7EdC67565160F587F37636194C34E74` |

## ABI Methods

### LynexRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: LYNX token holders vote-lock to direct gauge emissions
- Linea-only deployment; the dominant DEX on Linea zkEVM
- LP tokens can be staked in gauges for LYNX emissions
- Input token must be ERC20-approved to the Router
