<!-- Generated from the SDK's registries. Do not edit. -->

# Gamma Strategies (`gamma`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Gamma Strategies is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Active concentrated liquidity management protocol. Manages Uniswap V3, Algebra, and other CL DEX positions with automated rebalancing via Hypervisor vaults.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Gamma` on ethereum, polygon |
| Chains | ethereum, polygon |

## Key Operations

- **deposit**: Deposit token pair into Gamma Hypervisor via UniProxy
- **withdraw**: Withdraw liquidity from Hypervisor

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- TVL: $200M+. Each Hypervisor is a vault for a specific token pair
- Deposit via UniProxy (not directly on Hypervisor) - UniProxy handles deposit ratio enforcement
- Use getDepositAmount() to find correct token1 amount for your token0 deposit
- The uint256[4] minIn/minAmounts array provides slippage protection (use zeros for no limit)
- Approve both token0 and token1 to UniProxy before depositing
- The Ethereum UniProxy is an older deployment; its `deposit` has no `minIn` (the `depositLegacy` template calls it).

## Its names in a program

On Ethereum, `Gamma` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's uniProxy, `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599`.
  require(Gamma.UniProxyLegacy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` | `Gamma.UniProxyLegacy` |
| [Polygon](../chains/polygon.md) | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6` | `Gamma.UniProxy` |

## ABI

### `HypervisorABI`

`import HypervisorABI from "./protocols/gamma/HypervisorABI.json";`

- `withdraw(uint256 shares, address to, address from, uint256[4] minAmounts) returns (uint256 amount0, uint256 amount1)`
- `balanceOf(address account) view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `getTotalAmounts() view returns (uint256 total0, uint256 total1)`

### `UniProxyABI`

`import UniProxyABI from "./protocols/gamma/UniProxyABI.json";` Speaks for: uniProxy.

- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos, uint256[4] minIn) returns (uint256 shares)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`

### `UniProxyLegacyABI`

`import UniProxyLegacyABI from "./protocols/gamma/UniProxyLegacyABI.json";` Speaks for: uniProxy.

- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos) returns (uint256 shares)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`
