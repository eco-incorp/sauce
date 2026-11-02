<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V1 (`liquity-v1`)

Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with a minimum 110% collateral ratio.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV1` on ethereum |
| Chains | ethereum |
| Document | [liquity-v1.md](../liquity-v1.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `LiquityV1` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's borrowerOperations, `0x24179CD81c9e782A4096035f7eC97fB8B783e007`.
  require(LiquityV1.BorrowerOperations != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `LiquityV1.BorrowerOperations` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lusd | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | `LiquityV1.Lusd` |

## ABI

### `BorrowerOperationsABI`

`import BorrowerOperationsABI from "./protocols/liquity-v1/BorrowerOperationsABI.json";` Speaks for: borrowerOperations.

- `_100pct() view returns (uint256)`
- `activePool() view returns (address)`
- `addColl(address _upperHint, address _lowerHint) payable`
- `adjustTrove(uint256 _maxFeePercentage, uint256 _collWithdrawal, uint256 _LUSDChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable`
- `BORROWING_FEE_FLOOR() view returns (uint256)`
- `CCR() view returns (uint256)`
- `claimCollateral()`
- `closeTrove()`
- `DECIMAL_PRECISION() view returns (uint256)`
- `defaultPool() view returns (address)`
- `getCompositeDebt(uint256 _debt) pure returns (uint256)`
- `getEntireSystemColl() view returns (uint256 entireSystemColl)`
- `getEntireSystemDebt() view returns (uint256 entireSystemDebt)`
- `isOwner() view returns (bool)`
- `lqtyStaking() view returns (address)`
- `lqtyStakingAddress() view returns (address)`
- `LUSD_GAS_COMPENSATION() view returns (uint256)`
- `lusdToken() view returns (address)`
- `MCR() view returns (uint256)`
- `MIN_NET_DEBT() view returns (uint256)`
- `moveETHGainToTrove(address _borrower, address _upperHint, address _lowerHint) payable`
- `NAME() view returns (string)`
- `openTrove(uint256 _maxFeePercentage, uint256 _LUSDAmount, address _upperHint, address _lowerHint) payable`
- `owner() view returns (address)`
- `PERCENT_DIVISOR() view returns (uint256)`
- `priceFeed() view returns (address)`
- `repayLUSD(uint256 _LUSDAmount, address _upperHint, address _lowerHint)`
- `setAddresses(address _troveManagerAddress, address _activePoolAddress, address _defaultPoolAddress, address _stabilityPoolAddress, address _gasPoolAddress, address _collSurplusPoolAddress, address _priceFeedAddress, address _sortedTrovesAddress, address _lusdTokenAddress, address _lqtyStakingAddress)`
- `sortedTroves() view returns (address)`
- `troveManager() view returns (address)`
- `withdrawColl(uint256 _collWithdrawal, address _upperHint, address _lowerHint)`
- `withdrawLUSD(uint256 _maxFeePercentage, uint256 _LUSDAmount, address _upperHint, address _lowerHint)`
