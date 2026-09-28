# Fluid

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

## Category

lending | Chains: Ethereum (1), Arbitrum (42161)

## SauceScript Functions

The Liquidity layer (`liquidity` below) has no user-level deposit or borrow function: its only entry point, `operate`, is restricted to Fluid's own protocols. Users lend through **fTokens** (ERC-4626 vaults such as fUSDC) and borrow through **Vaults**.

### deposit

Deposit the fToken's underlying asset and receive fToken shares.

```typescript
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.deposit(amount, to);
}
```

- `fTokenAddress`: the fToken for the asset (e.g. fUSDC `0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33` on Ethereum)
- `to`: Address that receives the shares
- Returns the shares minted
- Requires ERC-20 approval of the underlying to the fToken

### withdraw

Withdraw an amount of the underlying asset, burning the owner's shares.

```typescript
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address, owner: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.withdraw(amount, to, owner);
}
```

- Returns the shares burned

### borrow

Borrow from a Vault position: `operate` with a positive debt delta.

```typescript
import { FluidVaultABI as IFluidVault } from "./abis";

function main(vaultAddress: Address, nftId: Uint256, amount: Uint256, to: Address): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, amount, to);
  return 1;
}
```

- `nftId`: the position NFT (0 opens a new position)
- The position must hold enough collateral (a positive `newCol` delta deposits it)

### repay

Repay a Vault position's debt: `operate` with a negative debt delta.

```typescript
import { FluidVaultABI as IFluidVault } from "./abis";

function main(
  vaultAddress: Address,
  nftId: Uint256,
  negativeDebtDelta: Uint256,
  to: Address,
): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, negativeDebtDelta, to);
  return 1;
}
```

- `negativeDebtDelta`: the repayment as a negative `int256`, passed in two's complement (`2**256 - amount`)
- Requires ERC-20 approval of the debt token to the Vault

## Deployed Addresses

| Chain    | Contract  | Address                                      |
| -------- | --------- | -------------------------------------------- |
| Ethereum | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |
| Arbitrum | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` |

## ABI Reference

### FluidLendingABI (an fToken)

- `deposit(uint256 assets, address receiver) returns (uint256 shares)` - ERC-4626 deposit
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)` - ERC-4626 withdraw
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)` - ERC-4626 redeem
- `asset() returns (address)` - The underlying token

### FluidVaultABI (a Vault)

- `operate(uint256 nftId, int256 newCol, int256 newDebt, address to) returns (uint256, int256, int256)` [payable] - Change a position's collateral and debt in one call; positive deltas deposit/borrow, negative ones withdraw/repay

## Notes

- Novel architecture: deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval (to the fToken or Vault)
- TVL: $1B+. Audited
