# Morpho Blue

Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loanToken, collateralToken, oracle, IRM, LLTV) tuple.

## Category

lending | Chains: Ethereum (1), Base (8453), Arc (5042)

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

## Deployed Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | morpho   | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| Ethereum | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` |
| Base     | morpho   | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |

## ABI Reference

### MorphoABI

- `supply(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)` - Supply loan tokens (specify assets OR shares, set other to 0)
- `withdraw(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)` - Withdraw loan tokens
- `borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)` - Borrow loan tokens
- `repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)` - Repay borrowed debt
- `supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)` - Supply collateral tokens (required before borrowing)
- `withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)` - Withdraw collateral tokens

MarketParams tuple: `(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)`

## Notes

- Markets are identified by the full marketParams tuple, not an address or ID
- Pass amount in `assets` param and set `shares` to 0 for standard operations
- Each market is fully isolated -- no cross-market risk contagion
- `lltv` is the Liquidation Loan-to-Value ratio (e.g. 86% = 860000000000000000)
- Supply collateral is separate from supplying loan tokens -- collateral does not earn interest
- Bundler3 contract allows batching multiple Morpho operations in a single transaction
- Same Morpho address on both Ethereum and Base
- TVL: $6B+. Audited
