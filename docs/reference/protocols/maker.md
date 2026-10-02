<!-- Generated from the SDK's registries. Do not edit. -->

# Maker (`maker`)

Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Maker` on ethereum |
| Chains | ethereum |

## Key Operations

- **depositToSDAI**: Deposit DAI into Savings DAI vault (ERC-4626)
- **withdrawFromSDAI**: Withdraw DAI from sDAI vault by asset amount
- **redeemFromSDAI**: Redeem sDAI shares for DAI

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit DAI into sDAI
import { SavingsDaiABI as ISavingsDai } from "./abis";
function main(sDAIAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.deposit(amount, receiver);
}

// Withdraw DAI from sDAI
import { SavingsDaiABI as ISavingsDai } from "./abis";
function main(sDAIAddress: Address, amount: Uint256, receiver: Address, owner: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.withdraw(amount, receiver, owner);
}

// Redeem sDAI shares for DAI
import { SavingsDaiABI as ISavingsDai } from "./abis";
function main(sDAIAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.redeem(shares, receiver, owner);
}
```

## Notes

- TVL: $8B+. sDAI is the preferred way to earn DSR yield (ERC-4626 compliant)
- DSR yield accrues automatically - sDAI appreciates against DAI over time
- Approve DAI to sDAI contract before depositing
- Pot is the internal DSR accumulator - chi() tracks the accumulated rate
- USDS is the rebranded DAI stablecoin

## Its names in a program

On Ethereum, `Maker` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's dai, `0x6B175474E89094C44Da98b954EedeAC495271d0F`.
  require(Maker.Dai != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | dai | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | `Maker.Dai` |
| [Ethereum](../chains/ethereum.md) | pot | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | `Maker.Pot` |
| [Ethereum](../chains/ethereum.md) | sDAI | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | `Maker.SDAI` |
| [Ethereum](../chains/ethereum.md) | usds | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | `Maker.Usds` |
| [Ethereum](../chains/ethereum.md) | vat | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | `Maker.Vat` |

## ABI

### `PotABI`

`import PotABI from "./protocols/maker/PotABI.json";` Speaks for: pot.

- `join(uint256 wad)`
- `exit(uint256 wad)`
- `chi() view returns (uint256)`
- `dsr() view returns (uint256)`

### `SavingsDaiABI`

`import SavingsDaiABI from "./protocols/maker/SavingsDaiABI.json";` Speaks for: sDAI.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
