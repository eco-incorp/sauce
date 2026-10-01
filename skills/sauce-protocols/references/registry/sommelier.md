<!-- Generated from the SDK's registries. Do not edit. -->

# Sommelier (`sommelier`)

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [sommelier.md](../sommelier.md): what it is for, how to choose it, its pitfalls |

## In a program

The registry records no deployment: `CellarABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import CellarABI from "./protocols/sommelier/CellarABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = CellarABI.at(TARGET);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` | no registry ABI |

## ABI

### `CellarABI`

`import CellarABI from "./protocols/sommelier/CellarABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
