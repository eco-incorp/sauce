# Instadapp

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources to find the cheapest flash loan.

## Category

infrastructure | Chains: Ethereum

## Key Operations

- **getRoutes**: Query available flash loan routes and their IDs
- **flashLoan**: Execute a flash loan via optimal route

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/instadapp";
```

## SauceScript Examples

```typescript
// Get available flash loan routes
import { FlashAggregatorABI as IFlashAggregator } from "./abis";
function main(aggregatorAddress: Address): Uint256 {
  const aggregator = IFlashAggregator.at(aggregatorAddress);
  aggregator.getRoutes();
  return 1;
}
```

## Key Addresses

| Chain    | Contract            | Address                                      |
| -------- | ------------------- | -------------------------------------------- |
| Ethereum | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` |

## ABI Methods

### FlashAggregatorABI

- `flashLoan(address[],uint256[],uint256,bytes,bytes)` - Execute flash loan. Params: tokens (array of token addresses), amounts (array of borrow amounts), route (route ID from getRoutes), data (callback data for the receiver), extraData (additional route-specific data)
- `getRoutes()` - List available flash loan routes. Returns routes (uint16[] of available route IDs). Pure function

## Notes

- Aggregates flash loans from: Aave V2/V3, Maker, Balancer, Compound, and others
- Each route has a different fee structure - use getRoutes to find available options
- route parameter selects which underlying protocol to borrow from
- Callback pattern: your contract must implement the receiver interface to repay
- Flash loans must be repaid within the same transaction (atomic)
