# Moonwell

Leading lending protocol on Base. Compound V2 fork with governance and safety module features.

## Category

lending | Chains: Base (8453)

## SauceScript Functions

### supply

Supply assets by minting mTokens. Exchange rate grows as interest accrues.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.mint(amount);
}
```

- `mTokenAddress`: The mToken market contract (each asset has its own mToken)
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the mToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against mToken collateral. Must call enterMarkets first.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.borrow(amount);
}
```

- Must enable collateral via `MoonwellComptroller.enterMarkets([mTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the mToken

## Deployed Addresses

| Chain | Contract    | Address                                      |
| ----- | ----------- | -------------------------------------------- |
| Base  | comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |

## ABI Reference

### MTokenABI

- `mint(uint256 mintAmount) returns (uint256)` - Supply underlying, receive mTokens
- `redeem(uint256 redeemTokens) returns (uint256)` - Redeem mTokens for underlying
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)` - Redeem exact underlying amount
- `borrow(uint256 borrowAmount) returns (uint256)` - Borrow underlying
- `repayBorrow(uint256 repayAmount) returns (uint256)` - Repay borrow debt

### MoonwellComptrollerABI

- `enterMarkets(address[] mTokens) returns (uint256[])` - Enable mTokens as collateral
- `exitMarket(address mToken) returns (uint256)` - Remove mToken from collateral

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Return values: 0 = success, non-zero = error code
- Base-only deployment. TVL: $500M+. Audited
