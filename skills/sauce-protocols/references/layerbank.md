# LayerBank

Leading lending protocol on Scroll. Compound-style markets (lTokens), but every user action goes through the Core contract, which names the market.

## Category

lending | Chains: Scroll (534352)

## SauceScript Functions

### supply

Supply underlying to a market through Core; Core mints the lTokens to the caller.

```typescript
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  return core.supply(lTokenAddress, amount);
}
```

- `lTokenAddress`: The lToken market contract (each asset has its own lToken)
- Returns the lTokens minted
- Requires ERC-20 approval of underlying to the lToken

### withdraw

Redeem an exact amount of underlying.

```typescript
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  return core.redeemUnderlying(lTokenAddress, amount);
}
```

### borrow

Borrow from a market against entered collateral.

```typescript
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  core.borrow(lTokenAddress, amount);
  return 1;
}
```

- Must enable collateral via `core.enterMarkets([lTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  core.repayBorrow(lTokenAddress, amount);
  return 1;
}
```

- Requires ERC-20 approval of underlying to the lToken

## Deployed Addresses

| Chain  | Contract | Address                                      |
| ------ | -------- | -------------------------------------------- |
| Scroll | core     | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` |

## ABI Reference

### LayerBankCoreABI

- `enterMarkets(address[] lTokens)` - Enable lTokens as collateral
- `exitMarket(address lToken)` - Remove lToken from collateral
- `supply(address lToken, uint256 uAmount) returns (uint256)` [payable] - Supply underlying, receive lTokens
- `redeemToken(address lToken, uint256 lAmount) returns (uint256)` - Redeem lTokens for underlying
- `redeemUnderlying(address lToken, uint256 uAmount) returns (uint256)` - Redeem an exact underlying amount
- `borrow(address lToken, uint256 amount)` - Borrow underlying
- `repayBorrow(address lToken, uint256 amount)` [payable] - Repay borrow debt

### LTokenABI (read side)

- `balanceOf(address account) returns (uint256)` - lToken balance
- `underlyingBalanceOf(address account) returns (uint256)` - Underlying value of the balance
- `borrowBalanceOf(address account) returns (uint256)` - Outstanding borrow
- `exchangeRate() returns (uint256)` - lToken/underlying exchange rate
- `underlying() returns (address)` - The market's underlying token

## Notes

- Unlike Compound V2, the lToken's own supply/borrow/redeem functions are callable only by Core
- Must call `enterMarkets` on Core before borrowing against any market
- Scroll-only deployment. TVL: $200M+. Audited
