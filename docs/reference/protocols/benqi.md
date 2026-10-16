<!-- Generated from the SDK's registries. Do not edit. -->

# Benqi (`benqi`)

> Benqi is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leading lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Benqi` on avalanche |
| Chains | avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also offers sAVAX liquid staking product (separate contract)
- Return values: 0 = success, non-zero = error code
- Avalanche-only deployment. TVL: $500M+. Audited

## Its names in a program

On Avalanche C-Chain, `Benqi` is a namespace: its contracts need no import.

```ts
function main() {
  // Avalanche C-Chain's comptroller, `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`.
  require(Benqi.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Avalanche C-Chain](../chains/avalanche.md) | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | `Benqi.Comptroller` |

## ABI

### `BenqiComptrollerABI`

`import BenqiComptrollerABI from "./protocols/benqi/BenqiComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] qiTokens) returns (uint256[])`
- `exitMarket(address qiToken) returns (uint256)`

### `QiTokenABI`

`import QiTokenABI from "./protocols/benqi/QiTokenABI.json";`

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
