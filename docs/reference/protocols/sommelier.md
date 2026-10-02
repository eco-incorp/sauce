<!-- Generated from the SDK's registries. Do not edit. -->

# Sommelier (`sommelier`)

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Sommelier` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Sommelier Cellar
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.deposit(assets, receiver);
}
```

## Notes

- Cellars are ERC-4626 vaults. Strategies managed off-chain via Cosmos governance.

## Its names in a program

On Ethereum, `Sommelier` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cellarRouter, `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2`.
  require(Sommelier.CellarRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` | `Sommelier.CellarRouter` |

## ABI

### `CellarABI`

`import CellarABI from "./protocols/sommelier/CellarABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
