# Benqi

Leading lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

## Category

lending | Chains: Avalanche (43114)

## SauceScript Functions

### supply

Supply assets by minting qiTokens. Exchange rate grows as interest accrues.

```typescript
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.mint(amount);
}
```

- `qiTokenAddress`: The qiToken market contract (each asset has its own qiToken)
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the qiToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against qiToken collateral. Must call enterMarkets first.

```typescript
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.borrow(amount);
}
```

- Must enable collateral via `BenqiComptroller.enterMarkets([qiTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the qiToken

## Deployed Addresses

| Chain     | Contract    | Address                                      |
| --------- | ----------- | -------------------------------------------- |
| Avalanche | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` |

## ABI Reference

### QiTokenABI

- `mint(uint256 mintAmount) returns (uint256)` - Supply underlying, receive qiTokens
- `redeem(uint256 redeemTokens) returns (uint256)` - Redeem qiTokens for underlying
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)` - Redeem exact underlying amount
- `borrow(uint256 borrowAmount) returns (uint256)` - Borrow underlying
- `repayBorrow(uint256 repayAmount) returns (uint256)` - Repay borrow debt

### BenqiComptrollerABI

- `enterMarkets(address[] qiTokens) returns (uint256[])` - Enable qiTokens as collateral
- `exitMarket(address qiToken) returns (uint256)` - Remove qiToken from collateral

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also offers sAVAX liquid staking product (separate contract)
- Return values: 0 = success, non-zero = error code
- Avalanche-only deployment. TVL: $500M+. Audited
