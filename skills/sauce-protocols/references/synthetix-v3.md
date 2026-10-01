# Synthetix V3

Modular liquidity protocol powering perpetual futures and synthetic assets on Base. Account-based system with collateral delegation to liquidity pools.

## Category

synthetics | Chains and addresses: [registry/synthetix-v3.md](registry/synthetix-v3.md)

## Key Operations

- **deposit**: Deposit collateral into an account
- **withdraw**: Withdraw collateral from an account
- **delegateCollateral**: Delegate collateral to a pool (via CoreProxy)
- **commitOrder**: Commit a perps trade order (via PerpsMarketProxy)
- **modifyCollateral**: Modify perps account collateral

## SauceScript Examples

```typescript
// Deposit collateral
import { CoreProxyABI as ICoreProxy } from "./abis";
function main(
  coreProxyAddress: Address,
  accountId: Uint256,
  collateralType: Address,
  amount: Uint256,
): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.deposit(accountId, collateralType, amount);
  return 1;
}

// Withdraw collateral
import { CoreProxyABI as ICoreProxy } from "./abis";
function main(
  coreProxyAddress: Address,
  accountId: Uint256,
  collateralType: Address,
  amount: Uint256,
): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.withdraw(accountId, collateralType, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/synthetix-v3.md](registry/synthetix-v3.md).

## Notes

- TVL: $300M+. Account-based system - create account NFT first
- accountId is uint128, collateral ops use token amount in token decimals
- delegateCollateral assigns collateral to a specific pool for earning fees
- commitOrder sizeDelta: positive = long, negative = short
- Settlement happens asynchronously via keepers after commitOrder
