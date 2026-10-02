<!-- Generated from the SDK's registries. Do not edit. -->

# Puffer Finance (`puffer`)

Liquid restaking protocol that issues pufETH. Deposits are natively restaked via EigenLayer for additional yield.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Puffer` on ethereum |
| Chains | ethereum |
| Document | [puffer.md](../puffer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Puffer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's pufETH, `0xD9A442856C234a39a81a089C06451EBAa4306a72`.
  require(Puffer.PufETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |

## ABI

### `PufferVaultABI`

`import PufferVaultABI from "./protocols/puffer/PufferVaultABI.json";` Speaks for: pufferVault.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
