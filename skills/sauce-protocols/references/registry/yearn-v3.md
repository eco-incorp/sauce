<!-- Generated from the SDK's registries. Do not edit. -->

# Yearn V3 (`yearn-v3`)

Yield aggregator protocol. V3 vaults follow ERC-4626 standard for automated yield optimization strategies.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [yearn-v3.md](../yearn-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

The registry records no deployment: `YearnV3VaultABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import YearnV3VaultABI from "./protocols/yearn-v3/YearnV3VaultABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = YearnV3VaultABI.at(TARGET);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F` | no registry ABI |

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
