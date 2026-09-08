# Arrakis Finance

Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions with rebalancing.

## Category

yield | Chains: Ethereum

## Key Operations

- **addLiquidity**: Add liquidity to an Arrakis vault via router (tuple params)
- **removeLiquidity**: Remove liquidity from vault via router (tuple params)

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/arrakis";
```

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

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | factory  | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` |
| Ethereum | router   | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` |

## ABI Methods

### ArrakisRouterABI

- `addLiquidity(tuple)` - Add liquidity. Tuple: (amount0Max, amount1Max, amount0Min, amount1Min, amountSharesMin, vault, receiver, gauge). Returns (amount0, amount1, sharesReceived)
- `removeLiquidity(tuple)` - Remove liquidity. Tuple: (burnAmount, amount0Min, amount1Min, vault, receiver, gauge). Returns (amount0, amount1)

### ArrakisVaultABI

- `totalSupply()` - Total vault shares outstanding
- `balanceOf(address)` - Query vault share balance
- `totalUnderlying()` - Total (amount0, amount1) managed by vault
- `token0()` - First token address
- `token1()` - Second token address

## Notes

- TVL: $50M+. Manages UniV3 concentrated liquidity positions automatically
- Both addLiquidity and removeLiquidity take struct/tuple params via the router
- Approve both token0 and token1 to the router before adding liquidity
- Vault shares represent proportional ownership of the managed position
- gauge param can be zero address if not staking in a gauge
