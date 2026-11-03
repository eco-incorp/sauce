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
  // Ethereum's bundler3, `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245`.
  require(MorphoBlue.Bundler3 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | `MorphoBlue.Bundler3` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [Monad](../../../sauce-chains/references/monad.md) | morpho | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | `MorphoBlue.Morpho` |
| [Arc](../../../sauce-chains/references/arc.md) | morpho | `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` | `MorphoBlue.Morpho` |
| [Base](../../../sauce-chains/references/base.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `MorphoABI`

`import MorphoABI from "./protocols/morpho-blue/MorphoABI.json";` Speaks for: morpho. The import is the contract's full ABI across every deployment; call it through the `MorphoBlue` namespace to have a function a chain's deployment does not run refused.

- `accrueInterest((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)`
- `borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)`
- `createMarket((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `enableIrm(address irm)`
- `enableLltv(uint256 lltv)`
- `extSloads(bytes32[] slots) view returns (bytes32[] res)`
- `feeRecipient() view returns (address)`
- `flashLoan(address token, uint256 assets, bytes data)`
- `idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)`: `loanToken` is a token, `collateralToken` is a token, `oracle` is a `MorphoBlue.Oracle`
- `isAuthorized(address, address) view returns (bool)`
- `isIrmEnabled(address) view returns (bool)`
- `isLltvEnabled(uint256) view returns (bool)`
- `liquidate((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, address borrower, uint256 seizedAssets, uint256 repaidShares, bytes data) returns (uint256, uint256)`
- `market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)`
- `nonce(address) view returns (uint256)`
- `owner() view returns (address)`
- `position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)`
- `repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)`
- `setAuthorization(address authorized, bool newIsAuthorized)`
- `setAuthorizationWithSig((address authorizer, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline) authorization, (uint8 v, bytes32 r, bytes32 s) signature)`
- `setFee((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 newFee)`
- `setFeeRecipient(address newFeeRecipient)`
- `setOwner(address newOwner)`
- `supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)`
- `supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)`
- `withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)`
- `withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)`

### `OracleABI`

`import OracleABI from "./protocols/morpho-blue/OracleABI.json";`

- `price() view returns (uint256)`
