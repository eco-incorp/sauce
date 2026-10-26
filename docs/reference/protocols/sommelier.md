<!-- Generated from the SDK's registries. Do not edit. -->

# Sommelier (`sommelier`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Sommelier is a yield vault: deposits are put to work to earn interest. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Sommelier` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## Notes

- Cellars are ERC-4626 vaults. Strategies managed off-chain via Cosmos governance.

## Its names in a program

On Ethereum, `Sommelier` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cellarRouter, `0x1D90366B0154fBcB5101c06a39c25D26cB48e889`.
  require(Sommelier.CellarRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cellarRouter | `0x1D90366B0154fBcB5101c06a39c25D26cB48e889` | `Sommelier.CellarRouter` |

## ABI

### `CellarABI`

`import CellarABI from "./protocols/sommelier/CellarABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
