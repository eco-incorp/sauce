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
  require(LiquityV1.BorrowerOperations != 0n);
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

- `openTrove(uint256 _maxFeePercentage, uint256 _LUSDAmount, address _upperHint, address _lowerHint) payable`
- `closeTrove()`
- `adjustTrove(uint256 _maxFeePercentage, uint256 _collWithdrawal, uint256 _LUSDChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable`
- `repayLUSD(uint256 _LUSDAmount, address _upperHint, address _lowerHint)`
