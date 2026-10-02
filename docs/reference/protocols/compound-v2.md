<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V2 (`compound-v2`)

Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV2` on ethereum |
| Chains | ethereum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Must call `Comptroller.enterMarkets([cTokenAddress])` before borrowing against a market
- Return values: 0 = success, non-zero = error code (e.g. 3 = COMPTROLLER_REJECTION)
- cToken exchange rate grows over time -- holding cTokens earns interest automatically
- Each asset has its own cToken contract (not a shared pool like Aave)
- Legacy protocol -- consider Compound V3 (Comet) for new deployments
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `CompoundV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cETH, `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5`.
  require(CompoundV2.CETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Ethereum](../chains/ethereum.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Ethereum](../chains/ethereum.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |

## ABI

### `CErc20ABI`

`import CErc20ABI from "./protocols/compound-v2/CErc20ABI.json";` Speaks for: cUSDC.

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`
- `borrowBalanceCurrent(address account) returns (uint256)`

### `ComptrollerABI`

`import ComptrollerABI from "./protocols/compound-v2/ComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] cTokens) returns (uint256[])`
- `exitMarket(address cToken) returns (uint256)`
