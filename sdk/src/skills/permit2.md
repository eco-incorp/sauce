# Permit2

Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols, improving security and UX.

## Category

infrastructure | Chains: Ethereum, Arbitrum, Optimism, Base, Polygon, BSC, Avalanche

## Key Operations

- **approve**: Set token allowance for a spender via Permit2
- **transferFrom**: Transfer tokens using a Permit2 allowance

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/permit2";
```

## SauceScript Examples

```typescript
// Approve token via Permit2
import { Permit2ABI as IPermit2 } from "./abis";
function main(
  permit2Address: Address,
  token: Address,
  spender: Address,
  amount: Uint256,
  expiration: Uint256,
): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.approve(token, spender, amount, expiration);
  return 1;
}

// Transfer tokens using Permit2 allowance
import { Permit2ABI as IPermit2 } from "./abis";
function main(
  permit2Address: Address,
  from: Address,
  to: Address,
  amount: Uint256,
  token: Address,
): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.transferFrom(from, to, amount, token);
  return 1;
}
```

## Key Addresses

| Chain        | Contract | Address                                      |
| ------------ | -------- | -------------------------------------------- |
| All 7 chains | permit2  | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

## ABI Methods

### Permit2ABI

- `approve(address,address,uint160,uint48)` - Set token allowance. Params: token, spender, amount (uint160 max), expiration (uint48 unix timestamp). No return value
- `transferFrom(address,address,uint160,address)` - Transfer using allowance. Params: from, to, amount (uint160), token. No return value
- `lockdown(tuple[])` - Revoke all approvals for specified token/spender pairs. Params: approvals (array of {token, spender} tuples). Emergency function to revoke compromised approvals

## Notes

- Same address on all 7 chains (deterministic CREATE2 deployment)
- Approve once: ERC-20 approve to Permit2, then use Permit2 to manage per-protocol allowances
- amount is uint160 (not uint256) - max value is type(uint160).max
- expiration is uint48 unix timestamp - approvals auto-expire for security
- Uniswap V3/V4, 1inch, and many protocols use Permit2 for token transfers
- lockdown is an emergency function to batch-revoke compromised approvals
