# Compound V2

Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.

## Category

lending | Chains and addresses: [registry/compound-v2.md](registry/compound-v2.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/compound-v2.md](registry/compound-v2.md).

## Notes

- Must call `Comptroller.enterMarkets([cTokenAddress])` before borrowing against a market
- Return values: 0 = success, non-zero = error code (e.g. 3 = COMPTROLLER_REJECTION)
- cToken exchange rate grows over time -- holding cTokens earns interest automatically
- Each asset has its own cToken contract (not a shared pool like Aave)
- Legacy protocol -- consider Compound V3 (Comet) for new deployments
- TVL: $1B+. Audited
