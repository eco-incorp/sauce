# Synthra V3

Concentrated-liquidity spot DEX on Arc, running unmodified Uniswap V3 contracts.

## Category

dex | Chains: Arc (5042)

## SauceScript Functions

### swap

Exact-input single-hop swap through SwapRouter02.

```typescript
import { SynthraV3SwapRouter02ABI as ISwapRouter02 } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISwapRouter02.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- SwapRouter02's params have no `deadline`
- `tokenIn` must be `approve`d to the router

## Deployed Addresses

| Chain | Contract                   | Address                                      |
| ----- | -------------------------- | -------------------------------------------- |
| Arc   | Factory                    | `0x6307fc239C7964942c1BfFE51930E55606619c74` |
| Arc   | SwapRouter02               | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` |
| Arc   | QuoterV2                   | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` |
| Arc   | NonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` |

## Notes

- The ABIs are Uniswap V3's (`getPool`, `exactInputSingle`, `quoteExactInputSingle`, `mint`, …): Synthra deploys those contracts unmodified
- On Arc there is no wrapped native token; pools pair against USDC's ERC-20 interface `0x3600…0000`
- Addresses come from docs.synthra.org's contract-addresses page
