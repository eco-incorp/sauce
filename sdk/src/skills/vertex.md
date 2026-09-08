# Vertex

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for sub-second order matching on Arbitrum.

## Category

perpetuals | Chains: Arbitrum

## Key Operations

- **depositCollateral**: Deposit collateral into Vertex endpoint

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/vertex";
```

## SauceScript Examples

```typescript
// Deposit collateral
import { EndpointABI as IEndpoint } from "./abis";
function main(endpointAddress: Address, productId: Uint256, amount: Uint256): Uint256 {
  const endpoint = IEndpoint.at(endpointAddress);
  endpoint.depositCollateral(0x000000000000000000000000, productId, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Arbitrum | endpoint      | `0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965` |
| Arbitrum | clearinghouse | `0x773bb71b0108b060b76746422ee810bfec9a963d` |

## ABI Methods

### EndpointABI

- `depositCollateral(bytes12,uint32,uint128)` - Deposit collateral. Params: subaccountName (bytes12), productId (uint32), amount (uint128)
- `submitSlowModeTransaction(bytes)` - Submit slow-mode tx (fallback when sequencer is down)

### ClearinghouseABI

- `withdrawCollateral(bytes12,uint32,uint128)` - Withdraw collateral. Same params as depositCollateral

## Notes

- TVL: $100M+. Off-chain sequencer for sub-second order matching
- Uses subaccount system (bytes12 identifier) for position isolation
- productId identifies the market (spot or perp)
- Most trading happens off-chain via sequencer - on-chain methods are for deposits/withdrawals
- Approve collateral token to endpoint before depositing
