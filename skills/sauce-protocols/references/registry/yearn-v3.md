<!-- Generated from the SDK's registries. Do not edit. -->

# Yearn V3 (`yearn-v3`)

Yield aggregator protocol. V3 vaults follow ERC-4626 standard for automated yield optimization strategies.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | `Yearn`: `yearn-v3` |
| Namespace | `YearnV3` on ethereum |
| Chains | ethereum |
| Document | [yearn-v3.md](../yearn-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `YearnV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's vaultFactory, `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F`.
  require(YearnV3.VaultFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F` | `YearnV3.VaultFactory` |

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
