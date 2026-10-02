# EigenLayer

Restaking protocol that enables staked ETH to secure additional protocols (AVS). Deposit LSTs into strategies to earn restaking rewards on top of staking yield.

## Category

restaking | Chains and addresses: [registry/eigenlayer.md](registry/eigenlayer.md)

## Key Operations

- **depositIntoStrategy**: Deposit LSTs (stETH, rETH, cbETH) into a restaking strategy
- **delegateTo**: Delegate restaked assets to an operator (via DelegationManager)
- **undelegate**: Undelegate from an operator, initiating withdrawal

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit LST into restaking strategy
import { StrategyManagerABI as IStrategyManager } from "./abis";
function main(
  strategyManagerAddress: Address,
  strategy: Address,
  token: Address,
  amount: Uint256,
): Uint256 {
  const sm = IStrategyManager.at(strategyManagerAddress);
  return sm.depositIntoStrategy(strategy, token, amount);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/eigenlayer.md](registry/eigenlayer.md).

## Notes

- TVL: $13B+. Foundation of the restaking ecosystem
- Approve LST token to StrategyManager before depositing
- Each LST has its own strategy contract (stETH, rETH, cbETH listed above)
- Withdrawal has a 7-day delay period after undelegating
- delegateTo requires approverSignatureAndExpiry tuple - use empty bytes + far-future expiry for typical cases
