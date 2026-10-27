<!-- Generated from the SDK's registries. Do not edit. -->

# Morpho Blue (`morpho-blue`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Morpho Blue is a lending market: deposit tokens to earn interest, or borrow against them. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loanToken, collateralToken, oracle, IRM, LLTV) tuple.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `MorphoBlue` on ethereum, monad, arc, base |
| Chains | ethereum, monad, arc, base |

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
the Pot (`pot`) to keep the position there. Morpho keeps the position in its own books, not
as a token, so it shows in no token balance:

```ts
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

## Notes

- A market is identified by its id, the keccak256 of its abi-encoded `MarketParams`, and is called
  with all five params. To supply by id, read them with Morpho's `idToMarketParams(id)` (a read
  the registry's ABI lacks, which `morpho-borrow` in this skill's examples declares in the ABI
  file beside it), then call `supply(params, assets, 0, onBehalf, "")` with `onBehalf` the
  user's wallet. A program takes the id as a `main` argument: the registry lists no markets, so
  the id comes from the user or from Morpho's own app
- Pass amount in `assets` param and set `shares` to 0 for standard operations
- Each market is fully isolated -- no cross-market risk contagion
- `lltv` is the Liquidation Loan-to-Value ratio (e.g. 86% = 860000000000000000)
- Supply collateral is separate from supplying loan tokens -- collateral does not earn interest
- Bundler3 contract allows batching multiple Morpho operations in a single transaction
- Same Morpho address on both Ethereum and Base
- TVL: $6B+. Audited

## Its names in a program

On Ethereum, `MorphoBlue` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's bundler3, `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`.
  require(MorphoBlue.Bundler3 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | `MorphoBlue.Bundler3` |
| [Ethereum](../chains/ethereum.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [Monad](../chains/monad.md) | morpho | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | `MorphoBlue.Morpho` |
| [Arc](../chains/arc.md) | morpho | `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` | `MorphoBlue.Morpho` |
| [Base](../chains/base.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |

## ABI

### `MorphoABI`

`import MorphoABI from "./protocols/morpho-blue/MorphoABI.json";` Speaks for: morpho.

- `supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)`
- `withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)`
- `borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)`
- `repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)`
- `supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)`
- `withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
