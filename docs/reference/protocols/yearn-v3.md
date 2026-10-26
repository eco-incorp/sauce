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

## What it offers

- **deposit**: Deposit assets into vault, receive yield-bearing shares
- **withdraw**: Withdraw assets by specifying asset amount
- **redeem**: Withdraw by specifying share amount

## Notes

- TVL: $500M+. ERC-4626 compliant (same interface as sfrxETH, pufETH, sDAI)
- Each vault has a unique address per underlying asset + strategy combination
- Approve underlying token to vault before depositing
- Vaults are deployed via factory - no single canonical vault address

## Its names in a program

On Ethereum, `YearnV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's vaultFactory, `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F`.
  require(YearnV3.VaultFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F` | `YearnV3.VaultFactory` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
