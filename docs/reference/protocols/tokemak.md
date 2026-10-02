<!-- Generated from the SDK's registries. Do not edit. -->

# Tokemak (`tokemak`)

Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Tokemak` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit assets into Autopool
- **withdraw**: Withdraw assets from Autopool
- **redeem**: Redeem Autopool shares

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit into Tokemak Autopool
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.deposit(assets, receiver);
}
```

## Notes

- Autopools are ERC-4626 vaults. Autopilot automatically rebalances across DeFi venues.

## Its names in a program

On Ethereum, `Tokemak` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's autopoolRegistry, `0x7E5828a3A6Ae75426d739E798140513A2E2964E4`.
  require(Tokemak.AutopoolRegistry != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` | `Tokemak.AutopoolRegistry` |
| [Ethereum](../chains/ethereum.md) | systemRegistry | `0x2218F90A98b0C070676f249EF44834686dAa4285` | `Tokemak.SystemRegistry` |
| [Ethereum](../chains/ethereum.md) | toke | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` | `Tokemak.Toke` |

## ABI

### `AutopoolABI`

`import AutopoolABI from "./protocols/tokemak/AutopoolABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `totalAssets() view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
