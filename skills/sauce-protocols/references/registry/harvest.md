<!-- Generated from the SDK's registries. Do not edit. -->

# Harvest Finance (`harvest`)

Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Harvest` on ethereum |
| Chains | ethereum |
| Document | [harvest.md](../harvest.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Harvest` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's controller, `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C`.
  require(Harvest.Controller != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` | `Harvest.Controller` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | depositHelper | `0xF8ce90c2710713552fb564869694B2505Bfc0846` | `Harvest.DepositHelper` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | farm | `0xa0246c9032bC3A600820415aE600c6388619A14D` | `Harvest.Farm` |

## ABI

### `VaultABI`

`import VaultABI from "./protocols/harvest/VaultABI.json";`

- `deposit(uint256 amount) returns (uint256)`
- `withdraw(uint256 numberOfShares) returns (uint256)`
- `getPricePerFullShare() view returns (uint256)`
- `underlyingBalanceWithInvestment() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
