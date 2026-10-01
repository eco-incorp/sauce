# LayerBank

Leading lending protocol on Scroll. Compound-style markets (lTokens), but every user action goes through the Core contract, which names the market.

## Category

lending | Chains and addresses: [registry/layerbank.md](registry/layerbank.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/layerbank.md](registry/layerbank.md).

## Notes

- Unlike Compound V2, the lToken's own supply/borrow/redeem functions are callable only by Core
- Must call `enterMarkets` on Core before borrowing against any market
- Scroll-only deployment. TVL: $200M+. Audited
