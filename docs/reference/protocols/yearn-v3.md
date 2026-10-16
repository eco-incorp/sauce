<!-- Generated from the SDK's registries. Do not edit. -->

# Yearn V3 (`yearn-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Yearn V3 is a yield vault: deposits are put to work to earn interest. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Yield aggregator protocol. V3 vaults follow the ERC-4626 standard for automated yield optimization with multi-strategy allocations.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | `Yearn`: `yearn-v3` |
| Namespace | `YearnV3` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit assets into vault, receive yield-bearing shares
- **withdraw**: Withdraw assets by specifying asset amount
- **redeem**: Withdraw by specifying share amount

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Yearn V3 vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.deposit(assets, receiver);
}

// Withdraw from vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.withdraw(assets, receiver, owner);
}

// Redeem shares
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Notes

- TVL: $500M+. ERC-4626 compliant (same interface as sfrxETH, pufETH, sDAI)
- Each vault has a unique address per underlying asset + strategy combination
- Approve underlying token to vault before depositing
- Vaults are deployed via factory - no single canonical vault address

## Its names in a program

On Ethereum, `YearnV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's vaultFactory, `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F`.
  require(YearnV3.VaultFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F` | `YearnV3.VaultFactory` |

## ABI

### `YearnV3VaultABI`

`import YearnV3VaultABI from "./protocols/yearn-v3/YearnV3VaultABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `totalAssets() view returns (uint256)`
- `pricePerShare() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
