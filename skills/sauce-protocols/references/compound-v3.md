# Compound V3

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

## Category

lending | Chains: Ethereum (1), Arbitrum (42161), Base (8453), Polygon (137), Optimism (10), Scroll (534352)

## SauceScript Functions

### supply

Supply the base asset to earn interest, or supply collateral to enable borrowing.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supply(asset, amount);
  return 1;
}
```

- `cometAddress`: The specific Comet market (e.g. cUSDCv3, cWETHv3)
- `asset`: If base asset (e.g. USDC) -- earns interest. If collateral asset -- enables borrowing
- Requires ERC-20 approval to the Comet address

### withdraw

Withdraw base asset or collateral. If withdrawing more base than supplied, creates a borrow position.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdraw(asset, amount);
  return 1;
}
```

- Withdrawing base asset beyond your supply automatically borrows

### supplyTo

Supply assets on behalf of another address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, dst: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supplyTo(dst, asset, amount);
  return 1;
}
```

- `dst`: Destination address that receives the supply position

### withdrawTo

Withdraw assets to a specific address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, to: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdrawTo(to, asset, amount);
  return 1;
}
```

- `to`: Address that receives the withdrawn tokens

## Deployed Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | cUSDCv3  | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` |
| Ethereum | cWETHv3  | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` |
| Ethereum | cUSDTv3  | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` |
| Arbitrum | cUSDCv3  | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` |
| Arbitrum | cUSDTv3  | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` |
| Base     | cUSDCv3  | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| Base     | cWETHv3  | `0x46e6b214b524310239732D51387075E0e70970bf` |
| Polygon  | cUSDCv3  | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` |
| Optimism | cUSDCv3  | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` |
| Scroll   | cUSDCv3  | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` |

## ABI Reference

### CometABI

- `supply(address asset, uint256 amount)` - Supply base asset (earns interest) or collateral asset
- `supplyTo(address dst, address asset, uint256 amount)` - Supply on behalf of another address
- `withdraw(address asset, uint256 amount)` - Withdraw base or collateral. Excess withdrawal borrows automatically
- `withdrawTo(address to, address asset, uint256 amount)` - Withdraw to specific recipient address
- `balanceOf(address account) returns (uint256)` - Get base asset supply balance (view)
- `borrowBalanceOf(address account) returns (uint256)` - Get outstanding borrow balance (view)

## Notes

- No separate borrow function -- withdrawing more base than supplied automatically borrows
- Each Comet market has ONE base asset (e.g. USDC) and multiple collateral assets
- No interest rate mode selection -- all borrows are variable rate
- Supply/withdraw of collateral does not earn interest, only the base asset earns
- Market names indicate the base asset: cUSDCv3 = USDC base, cWETHv3 = WETH base
- All supply operations require ERC-20 approval to the Comet address
- TVL: $3.5B+. Audited
