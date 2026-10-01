# Gamma Strategies

Active concentrated liquidity management protocol. Manages Uniswap V3, Algebra, and other CL DEX positions with automated rebalancing via Hypervisor vaults.

## Category

yield | Chains and addresses: [registry/gamma.md](registry/gamma.md)

## Key Operations

- **deposit**: Deposit token pair into Gamma Hypervisor via UniProxy
- **withdraw**: Withdraw liquidity from Hypervisor

## SauceScript Examples

```typescript
// Deposit into Gamma Hypervisor
import { UniProxyABI as IUniProxy } from "./abis";
function main(
  uniProxyAddress: Address,
  deposit0: Uint256,
  deposit1: Uint256,
  to: Address,
  pos: Address,
): Uint256 {
  const proxy = IUniProxy.at(uniProxyAddress);
  return proxy.deposit(deposit0, deposit1, to, pos, [0, 0, 0, 0]);
}

// Withdraw from Hypervisor
import { HypervisorABI as IHypervisor } from "./abis";
function main(hypervisorAddress: Address, shares: Uint256, to: Address, from: Address): Uint256 {
  const hv = IHypervisor.at(hypervisorAddress);
  hv.withdraw(shares, to, from, [0, 0, 0, 0]);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gamma.md](registry/gamma.md).

## Notes

- TVL: $200M+. Each Hypervisor is a vault for a specific token pair
- Deposit via UniProxy (not directly on Hypervisor) - UniProxy handles deposit ratio enforcement
- Use getDepositAmount() to find correct token1 amount for your token0 deposit
- The uint256[4] minIn/minAmounts array provides slippage protection (use zeros for no limit)
- Approve both token0 and token1 to UniProxy before depositing
- The Ethereum UniProxy is an older deployment; its `deposit` has no `minIn` (the `depositLegacy` template calls it).
