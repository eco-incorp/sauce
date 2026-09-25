# Venus

Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

## Category

lending | Chains: BSC (56)

## SauceScript Functions

### supply

Supply assets by minting vTokens. Exchange rate grows as interest accrues.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.mint(amount);
}
```

- `vTokenAddress`: The vToken market contract (each asset has its own vToken, e.g. vBNB)
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the vToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against vToken collateral. Must call enterMarkets first.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.borrow(amount);
}
```

- Must enable collateral via `VenusComptroller.enterMarkets([vTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the vToken

## Deployed Addresses

| Chain | Contract    | Address                                      |
| ----- | ----------- | -------------------------------------------- |
| BSC   | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` |
| BSC   | vBNB        | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` |

## ABI Reference

### VTokenABI

- `mint(uint256 mintAmount) returns (uint256)` - Supply underlying, receive vTokens
- `redeem(uint256 redeemTokens) returns (uint256)` - Redeem vTokens for underlying
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)` - Redeem exact underlying amount
- `borrow(uint256 borrowAmount) returns (uint256)` - Borrow underlying
- `repayBorrow(uint256 repayAmount) returns (uint256)` - Repay borrow debt
- `balanceOfUnderlying(address owner) returns (uint256)` - Get underlying balance including accrued interest (view)

### VenusComptrollerABI

- `enterMarkets(address[] vTokens) returns (uint256[])` - Enable vTokens as collateral
- `exitMarket(address vToken) returns (uint256)` - Remove vToken from collateral

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also supports VAI stablecoin minting (separate contract)
- Return values: 0 = success, non-zero = error code
- BSC-only deployment. TVL: $3B+. Audited
