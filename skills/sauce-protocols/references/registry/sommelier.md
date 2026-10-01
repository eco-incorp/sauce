<!-- Generated from the SDK's registries. Do not edit. -->

# Sommelier (`sommelier`)

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Sommelier` on ethereum |
| Chains | ethereum |
| Document | [sommelier.md](../sommelier.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Sommelier` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cellarRouter, `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2`.
  require(Sommelier.CellarRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` | `Sommelier.CellarRouter` |

## ABI

### `CellarABI`

`import CellarABI from "./protocols/sommelier/CellarABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
