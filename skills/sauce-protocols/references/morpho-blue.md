# Morpho Blue

Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loanToken, collateralToken, oracle, IRM, LLTV) tuple.

## Category

lending | Chains and addresses: [registry/morpho-blue.md](registry/morpho-blue.md)

## SauceScript Functions

### supply

Supply loan tokens to a specific market. Earns interest from borrowers.

```typescript
import { MorphoABI as IMorpho } from "./abis";

function main(
  morphoAddress: Address,
  loanToken: Address,
  collateralToken: Address,
  oracle: Address,
  irm: Address,
  lltv: Uint256,
  amount: Uint256,
  onBehalf: Address,
): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.supply(
    {
      loanToken: loanToken,
      collateralToken: collateralToken,
      oracle: oracle,
      irm: irm,
      lltv: lltv,
    },
    amount,
    0,
    onBehalf,
    0x00,
  );
  return 1;
}
```

- All 5 marketParams fields (loanToken, collateralToken, oracle, irm, lltv) identify the market
- `amount`: Supply by assets (set shares param to 0)
- `onBehalf`: Address that receives the supply position
- `data`: Callback data, use `0x00` for no callback
- Requires ERC-20 approval of loanToken to the Morpho address

### withdraw

Withdraw supplied loan tokens from a market.

```typescript
import { MorphoABI as IMorpho } from "./abis";

function main(
  morphoAddress: Address,
  loanToken: Address,
  collateralToken: Address,
  oracle: Address,
  irm: Address,
  lltv: Uint256,
  amount: Uint256,
  onBehalf: Address,
  receiver: Address,
): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.withdraw(
    {
      loanToken: loanToken,
      collateralToken: collateralToken,
      oracle: oracle,
      irm: irm,
      lltv: lltv,
    },
    amount,
    0,
    onBehalf,
    receiver,
  );
  return 1;
}
```

- `receiver`: Address that receives the withdrawn tokens

### borrow

Borrow loan tokens against supplied collateral.

```typescript
import { MorphoABI as IMorpho } from "./abis";

function main(
  morphoAddress: Address,
  loanToken: Address,
  collateralToken: Address,
  oracle: Address,
  irm: Address,
  lltv: Uint256,
  amount: Uint256,
  onBehalf: Address,
  receiver: Address,
): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.borrow(
    {
      loanToken: loanToken,
      collateralToken: collateralToken,
      oracle: oracle,
      irm: irm,
      lltv: lltv,
    },
    amount,
    0,
    onBehalf,
    receiver,
  );
  return 1;
}
```

- Must have sufficient collateral supplied via `supplyCollateral` first

### repay

Repay borrowed loan tokens.

```typescript
import { MorphoABI as IMorpho } from "./abis";

function main(
  morphoAddress: Address,
  loanToken: Address,
  collateralToken: Address,
  oracle: Address,
  irm: Address,
  lltv: Uint256,
  amount: Uint256,
  onBehalf: Address,
): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.repay(
    {
      loanToken: loanToken,
      collateralToken: collateralToken,
      oracle: oracle,
      irm: irm,
      lltv: lltv,
    },
    amount,
    0,
    onBehalf,
    0x00,
  );
  return 1;
}
```

- Requires ERC-20 approval of loanToken to the Morpho address

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/morpho-blue.md](registry/morpho-blue.md).

## Notes

- Markets are identified by the full marketParams tuple, not an address or ID
- Pass amount in `assets` param and set `shares` to 0 for standard operations
- Each market is fully isolated -- no cross-market risk contagion
- `lltv` is the Liquidation Loan-to-Value ratio (e.g. 86% = 860000000000000000)
- Supply collateral is separate from supplying loan tokens -- collateral does not earn interest
- Bundler3 contract allows batching multiple Morpho operations in a single transaction
- Same Morpho address on both Ethereum and Base
- TVL: $6B+. Audited
