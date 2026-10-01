# Permit2

Universal token approval infrastructure by Uniswap. Provides a single approval contract for all DeFi protocols, improving security and UX.

## Category

infrastructure | Chains and addresses: [registry/permit2.md](registry/permit2.md)

## Key Operations

- **approve**: Set token allowance for a spender via Permit2
- **transferFrom**: Transfer tokens using a Permit2 allowance

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/permit2.md](registry/permit2.md).

## Notes

- Same address on all 7 chains (deterministic CREATE2 deployment)
- Approve once: ERC-20 approve to Permit2, then use Permit2 to manage per-protocol allowances
- amount is uint160 (not uint256) - max value is type(uint160).max
- expiration is uint48 unix timestamp - approvals auto-expire for security
- Uniswap V3/V4, 1inch, and many protocols use Permit2 for token transfers
- lockdown is an emergency function to batch-revoke compromised approvals
