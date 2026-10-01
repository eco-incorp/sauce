# Arrakis Finance

Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions with rebalancing.

## Category

yield | Chains and addresses: [registry/arrakis.md](registry/arrakis.md)

## Key Operations

- **addLiquidity**: Add liquidity to an Arrakis vault via router (tuple params)
- **removeLiquidity**: Remove liquidity from vault via router (tuple params)

## SauceScript Examples

```typescript
// Add liquidity - NOTE: uses tuple params via router
import { ArrakisRouterABI as IArrakisRouter } from "./abis";
function main(
  routerAddress: Address,
  vault: Address,
  receiver: Address,
  amount0Max: Uint256,
  amount1Max: Uint256,
): Uint256 {
  const router = IArrakisRouter.at(routerAddress);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/arrakis.md](registry/arrakis.md).

## Notes

- TVL: $50M+. Manages UniV3 concentrated liquidity positions automatically
- Both addLiquidity and removeLiquidity take struct/tuple params via the router
- Approve both token0 and token1 to the router before adding liquidity
- Vault shares represent proportional ownership of the managed position
- gauge param can be zero address if not staking in a gauge
- The vault itself does not report its underlying amounts; ArrakisV2Helper's `totalUnderlying(vault)` does
