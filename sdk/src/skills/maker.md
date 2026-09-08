# Maker

Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.

## Category

cdp | Chains: Ethereum

## Key Operations

- **depositToSDAI**: Deposit DAI into Savings DAI vault (ERC-4626)
- **withdrawFromSDAI**: Withdraw DAI from sDAI vault by asset amount
- **redeemFromSDAI**: Redeem sDAI shares for DAI

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/maker";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | dai      | `0x6B175474E89094C44Da98b954EedeAC495271d0F` |
| Ethereum | usds     | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` |
| Ethereum | sDAI     | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` |
| Ethereum | vat      | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` |
| Ethereum | pot      | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` |

## ABI Methods

### SavingsDaiABI (ERC-4626)

- `deposit(uint256,address)` - Deposit DAI, receive sDAI shares. Params: assets (DAI amount), receiver. Returns shares minted
- `withdraw(uint256,address,address)` - Withdraw by DAI amount. Params: assets (DAI to withdraw), receiver, owner. Returns shares burned
- `redeem(uint256,address,address)` - Redeem sDAI shares. Params: shares (sDAI to burn), receiver, owner. Returns assets (DAI received)
- `convertToShares(uint256)` - Preview DAI to sDAI conversion. Params: assets. Returns shares
- `convertToAssets(uint256)` - Preview sDAI to DAI conversion. Params: shares. Returns assets

### PotABI (DSR Engine)

- `join(uint256)` - Join DAI savings (internal). Params: wad (DAI amount in 18 decimals)
- `exit(uint256)` - Exit DAI savings (internal). Params: wad
- `chi()` - Current accumulated DSR rate (view). Returns rate accumulator (ray, 27 decimals)
- `dsr()` - Current DSR per-second rate (view). Returns rate (ray)

## Notes

- TVL: $8B+. sDAI is the preferred way to earn DSR yield (ERC-4626 compliant)
- DSR yield accrues automatically - sDAI appreciates against DAI over time
- Approve DAI to sDAI contract before depositing
- Pot is the internal DSR accumulator - chi() tracks the accumulated rate
- USDS is the rebranded DAI stablecoin
