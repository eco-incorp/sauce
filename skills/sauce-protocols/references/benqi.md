# Benqi

Leading lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

## Category

lending | Chains and addresses: [registry/benqi.md](registry/benqi.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/benqi.md](registry/benqi.md).

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also offers sAVAX liquid staking product (separate contract)
- Return values: 0 = success, non-zero = error code
- Avalanche-only deployment. TVL: $500M+. Audited
