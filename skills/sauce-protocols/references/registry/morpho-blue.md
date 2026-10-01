<!-- Generated from the SDK's registries. Do not edit. -->

# Morpho Blue (`morpho-blue`)

Minimal and gas-efficient lending primitive with permissionless market creation. Markets are defined by a unique (loan token, collateral token, oracle, IRM, LLTV) tuple.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `MorphoBlue` on ethereum, monad, arc, base |
| Chains | ethereum, monad, arc, base |
| Document | [morpho-blue.md](../morpho-blue.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `MorphoBlue` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's morpho, `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.
  require(MorphoBlue.Morpho != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [Monad](../../../sauce-chains/references/monad.md) | morpho | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | `MorphoBlue.Morpho` |
| [Arc](../../../sauce-chains/references/arc.md) | morpho | `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` | `MorphoBlue.Morpho` |
| [Base](../../../sauce-chains/references/base.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |

## ABI

### `MorphoABI`

`import MorphoABI from "./protocols/morpho-blue/MorphoABI.json";` Speaks for: morpho.

- `supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)`
- `withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)`
- `borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)`
- `repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)`
- `supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)`
- `withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)`
