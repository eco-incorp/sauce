# Compound V2

Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.

## Category

lending | Chains: Ethereum (1)

## SauceScript Functions

### supply

Supply assets by minting cTokens. The cToken exchange rate increases over time as interest accrues.

```typescript
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.mint(amount);
}
```

- `cTokenAddress`: The cToken market contract (e.g. cUSDC, cETH)
- `amount`: Amount of underlying token to supply
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of the underlying token to the cToken address

### withdraw

Withdraw by specifying the amount of underlying tokens to receive.

```typescript
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.redeemUnderlying(amount);
}
```

- `amount`: Amount of underlying tokens to withdraw
- Returns 0 on success, error code on failure

### borrow

Borrow assets against supplied collateral. Must call `enterMarkets` on Comptroller first.

```typescript
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.borrow(amount);
}
```

- `amount`: Amount of underlying to borrow
- Must have collateral enabled via Comptroller.enterMarkets first

### repay

Repay borrowed assets.

```typescript
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.repayBorrow(amount);
}
```

- `amount`: Amount to repay. Use `type(uint256).max` to repay full debt
- Requires ERC-20 approval of the underlying token to the cToken

## Deployed Addresses

| Chain    | Contract    | Address                                      |
| -------- | ----------- | -------------------------------------------- |
| Ethereum | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` |
| Ethereum | cETH        | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` |
| Ethereum | cUSDC       | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` |

## ABI Reference

### CErc20ABI

- `mint(uint256 mintAmount) returns (uint256)` - Supply underlying, receive cTokens. Returns 0 on success
- `redeem(uint256 redeemTokens) returns (uint256)` - Redeem cTokens for underlying (specify cToken amount)
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)` - Redeem for exact underlying amount
- `borrow(uint256 borrowAmount) returns (uint256)` - Borrow underlying tokens
- `repayBorrow(uint256 repayAmount) returns (uint256)` - Repay borrow debt
- `balanceOfUnderlying(address owner) returns (uint256)` - Get underlying balance including accrued interest. Not a view: it accrues interest first, so it cannot be STATICCALLed
- `borrowBalanceCurrent(address account) returns (uint256)` - Get current borrow balance with interest. Not a view: it accrues interest first

### ComptrollerABI

- `enterMarkets(address[] cTokens) returns (uint256[])` - Enable cTokens as collateral. Must call before borrowing
- `exitMarket(address cToken) returns (uint256)` - Remove cToken from collateral (fails if would cause shortfall)

## Notes

- Must call `Comptroller.enterMarkets([cTokenAddress])` before borrowing against a market
- Return values: 0 = success, non-zero = error code (e.g. 3 = COMPTROLLER_REJECTION)
- cToken exchange rate grows over time -- holding cTokens earns interest automatically
- Each asset has its own cToken contract (not a shared pool like Aave)
- Legacy protocol -- consider Compound V3 (Comet) for new deployments
- TVL: $1B+. Audited
