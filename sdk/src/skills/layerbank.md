# LayerBank

Leading lending protocol on Scroll. Compound V2 fork optimized for L2 rollups with low gas costs.

## Category

lending | Chains: Scroll (534352)

## SauceScript Functions

### supply

Supply assets by minting lTokens. Exchange rate grows as interest accrues.

```typescript
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.mint(amount);
}
```

- `lTokenAddress`: The lToken market contract (each asset has its own lToken)
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the lToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against lToken collateral. Must call enterMarkets first.

```typescript
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.borrow(amount);
}
```

- Must enable collateral via `LayerBankCore.enterMarkets([lTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the lToken

## Deployed Addresses

| Chain  | Contract | Address                                      |
| ------ | -------- | -------------------------------------------- |
| Scroll | core     | `0x009a0b7C38B542208936F1179151CD08E2943833` |

## ABI Reference

### LTokenABI

- `mint(uint256 mintAmount) returns (uint256)` - Supply underlying, receive lTokens
- `redeem(uint256 redeemTokens) returns (uint256)` - Redeem lTokens for underlying
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)` - Redeem exact underlying amount
- `borrow(uint256 borrowAmount) returns (uint256)` - Borrow underlying
- `repayBorrow(uint256 repayAmount) returns (uint256)` - Repay borrow debt

### LayerBankCoreABI

- `enterMarkets(address[] lTokens) returns (uint256[])` - Enable lTokens as collateral
- `exitMarket(address lToken) returns (uint256)` - Remove lToken from collateral

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Core contract before borrowing against any market
- Return values: 0 = success, non-zero = error code
- Scroll-only deployment. TVL: $200M+. Audited
