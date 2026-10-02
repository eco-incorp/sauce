<!-- Generated from the SDK's registries. Do not edit. -->

# Venus (`venus`)

Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Venus` on bsc |
| Chains | bsc |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### supply

Supply assets by minting vTokens. Exchange rate grows as interest accrues.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.mint(amount);
}
```

- `vTokenAddress`: A BEP-20 vToken market (each asset has its own vToken, e.g. vUSDC). vBNB takes native BNB instead: see `VBNBABI`
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

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also supports VAI stablecoin minting (separate contract)
- Return values: 0 = success, non-zero = error code
- BSC-only deployment. TVL: $3B+. Audited
- vBNB (`vBNB`) takes native BNB, so its `mint` and `repayBorrow` take no amount: the BNB sent with the call is the amount.

## Its names in a program

On BNB Chain, `Venus` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's comptroller, `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  require(Venus.Comptroller != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `Venus.Comptroller` |
| [BNB Chain](../chains/bsc.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `Venus.VBNB` |

## ABI

### `VBNBABI`

`import VBNBABI from "./protocols/venus/VBNBABI.json";` Speaks for: vBNB.

- `mint() payable`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow() payable`
- `balanceOfUnderlying(address owner) returns (uint256)`

### `VTokenABI`

`import VTokenABI from "./protocols/venus/VTokenABI.json";`

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`

### `VenusComptrollerABI`

`import VenusComptrollerABI from "./protocols/venus/VenusComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] vTokens) returns (uint256[])`
- `exitMarket(address vToken) returns (uint256)`
