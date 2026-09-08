# Abracadabra

Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.

## Category

cdp | Chains: Ethereum, Arbitrum

## Key Operations

- **borrow**: Borrow MIM from a Cauldron
- **repay**: Repay MIM debt
- **addCollateral**: Add collateral to a Cauldron position
- **removeCollateral**: Remove collateral from a Cauldron position

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/abracadabra";
```

## SauceScript Examples

```typescript
// Borrow MIM from Cauldron
import { CauldronABI as ICauldron } from "./abis";
function main(
  cauldronAddress: Address,
  to: Address,
  amount: Uint256,
): { part: Uint256; share: Uint256 } {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.borrow(to, amount);
}

// Repay MIM debt
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, part: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.repay(to, 0, part);
}

// Add collateral
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.addCollateral(to, 0, share);
  return 1;
}

// Remove collateral
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.removeCollateral(to, share);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` |
| Ethereum | mim      | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` |
| Arbitrum | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` |
| Arbitrum | mim      | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` |

## ABI Methods

### CauldronABI

- `borrow(address,uint256)` - Borrow MIM. Params: to (recipient), amount (MIM to borrow). Returns (part, share) - part is debt units, share is DegenBox shares
- `repay(address,bool,uint256)` - Repay MIM debt. Params: to (whose debt to repay), skim (true=use DegenBox balance), part (debt part to repay). Returns amount repaid
- `addCollateral(address,bool,uint256)` - Add collateral. Params: to (position owner), skim (true=use DegenBox balance), share (collateral shares to add)
- `removeCollateral(address,uint256)` - Remove collateral. Params: to (recipient), share (collateral shares to remove)
- `userCollateralShare(address)` - Query user's collateral. Params: user. Returns share amount
- `userBorrowPart(address)` - Query user's debt. Params: user. Returns borrow part

### DegenBoxABI

- `deposit(address,address,address,uint256,uint256)` - Deposit tokens into DegenBox. Payable. Params: token, from, to, amount (0 if using share), share (0 if using amount). Returns (amountOut, shareOut)
- `withdraw(address,address,address,uint256,uint256)` - Withdraw from DegenBox. Params: token, from, to, amount (0 if using share), share (0 if using amount). Returns (amountOut, shareOut)
- `balanceOf(address,address)` - Query balance. Params: token, user. Returns share amount

## Notes

- Isolated Cauldron markets - each has specific collateral type and risk parameters
- DegenBox is the underlying vault that holds all assets (BentoBox fork)
- Amounts use "part" (debt accounting) and "share" (DegenBox shares) - not raw token amounts
- skim=false means transfer tokens from caller; skim=true means use tokens already in DegenBox
- Deposit collateral to DegenBox first, then addCollateral to a Cauldron
- Common collateral: sSPELL, yv tokens, LP tokens, yield-bearing assets
