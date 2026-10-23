# Morpho Blue

Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loanToken, collateralToken, oracle, IRM, LLTV) tuple.

## When to use it

- Isolated markets: each pairs one loan asset with one collateral, its own oracle, interest
  rate model and liquidation LTV (`lltv`), named by those five `MarketParams`. One market's bad
  debt does not reach another.
- Choose it to lend or borrow in a specific pair with a specific oracle, or to build on a market
  someone created; for shared liquidity across many assets, Aave V3.

## Pitfalls for a program

- A market exists only for exactly the `MarketParams` it was created with: pass all five.
- Give exactly one of `assets` and `shares`, the other `0`.
- Vet the market's oracle: it alone decides liquidations there.
- `supplyCollateral` earns nothing; only `supply` of the loan asset earns interest.
- Approve Morpho for the amount; `data` is empty bytes unless you want its callback, which a
  Sauce program cannot receive.

## In a Sauce program

Supply the loan asset to a market given as `main`'s input, for `onBehalf`: the user's wallet, or
the Pot (`ctx.self()`) to keep the position there. Morpho keeps the position in its own books, not
as a token, so it shows in no token balance:

```sauce chain=base,ethereum
function main(
  market: { loanToken: Address, collateralToken: Address, oracle: Address, irm: Address, lltv: Uint256 },
  assets: Uint256,
  onBehalf: Address
) {
  Token(market.loanToken).approve(MorphoBlue.Morpho, assets);
  const empty = hex``;
  MorphoBlue.Morpho.supply(market, assets, 0, onBehalf, empty);
}
```

## Category

lending | Chains and addresses: [registry/morpho-blue.md](registry/morpho-blue.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
    hex``,
  );
  return 1;
}
```

- All 5 marketParams fields (loanToken, collateralToken, oracle, irm, lltv) identify the market
- `amount`: Supply by assets (set shares param to 0)
- `onBehalf`: Address that receives the supply position
- `data`: Callback data, use ` hex`` ` for no callback
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
    hex``,
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
