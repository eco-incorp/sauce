# Fluid

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

## Category

lending | Chains: Ethereum (1), Arbitrum (42161)

## SauceScript Functions

### deposit

Deposit tokens into the Fluid liquidity layer.

```typescript
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.deposit(token, amount, to);
}
```

- `token`: ERC-20 token address to deposit
- `to`: Address that receives the deposit position
- Returns shares representing the deposit
- Requires ERC-20 approval to the liquidity address

### withdraw

Withdraw tokens from the liquidity layer.

```typescript
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.withdraw(token, amount, to);
}
```

- Returns actual amount withdrawn

### borrow

Borrow tokens against deposited assets.

```typescript
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.borrow(token, amount, to);
}
```

- Must have sufficient collateral deposited first
- Returns actual amount borrowed

### repay

Repay borrowed tokens.

```typescript
import { FluidLendingABI as IFluidLending } from "./abis";

function main(
  liquidityAddress: Address,
  token: Address,
  amount: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.repay(token, amount, onBehalfOf);
}
```

- `onBehalfOf`: Address whose debt is being repaid
- Requires ERC-20 approval to the liquidity address
- Returns actual amount repaid

## Deployed Addresses

| Chain    | Contract  | Address                                      |
| -------- | --------- | -------------------------------------------- |
| Ethereum | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |
| Arbitrum | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |

## ABI Reference

### FluidLendingABI

- `deposit(address token, uint256 amount, address to) returns (uint256 shares)` - Deposit token into liquidity layer
- `withdraw(address token, uint256 amount, address to) returns (uint256 actualAmount)` - Withdraw token
- `borrow(address token, uint256 amount, address to) returns (uint256 actualAmount)` - Borrow token against deposits
- `repay(address token, uint256 amount, address onBehalfOf) returns (uint256 actualAmount)` - Repay borrowed debt

## Notes

- Novel architecture: deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval
- TVL: $1B+. Audited
