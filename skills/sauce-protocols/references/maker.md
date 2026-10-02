# Maker

Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.

## Category

cdp | Chains and addresses: [registry/maker.md](registry/maker.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/maker.md](registry/maker.md).

## Notes

- TVL: $8B+. sDAI is the preferred way to earn DSR yield (ERC-4626 compliant)
- DSR yield accrues automatically - sDAI appreciates against DAI over time
- Approve DAI to sDAI contract before depositing
- Pot is the internal DSR accumulator - chi() tracks the accumulated rate
- USDS is the rebranded DAI stablecoin
