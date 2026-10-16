<!-- Generated from the SDK's registries. Do not edit. -->

# LayerBank (`layerbank`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> LayerBank is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leading lending protocol on Scroll. Compound-style markets (lTokens), but every user action goes through the Core contract, which names the market.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Layerbank` on scroll |
| Chains | scroll |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Unlike Compound V2, the lToken's own supply/borrow/redeem functions are callable only by Core
- Must call `enterMarkets` on Core before borrowing against any market
- Scroll-only deployment. TVL: $200M+. Audited

## Its names in a program

On Scroll, `Layerbank` is a namespace: its contracts need no import.

```ts
function main() {
  // Scroll's core, `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa`.
  require(Layerbank.Core != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Scroll](../chains/scroll.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |

## ABI

### `LTokenABI`

`import LTokenABI from "./protocols/layerbank/LTokenABI.json";`

- `balanceOf(address account) view returns (uint256)`
- `underlyingBalanceOf(address account) view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
- `exchangeRate() view returns (uint256)`
- `underlying() view returns (address)`

### `LayerBankCoreABI`

`import LayerBankCoreABI from "./protocols/layerbank/LayerBankCoreABI.json";` Speaks for: core.

- `enterMarkets(address[] lTokens)`
- `exitMarket(address lToken)`
- `supply(address lToken, uint256 uAmount) payable returns (uint256)`
- `redeemToken(address lToken, uint256 lAmount) returns (uint256)`
- `redeemUnderlying(address lToken, uint256 uAmount) returns (uint256)`
- `borrow(address lToken, uint256 amount)`
- `repayBorrow(address lToken, uint256 amount) payable`
