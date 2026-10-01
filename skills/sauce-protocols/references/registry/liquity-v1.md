<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V1 (`liquity-v1`)

Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with a minimum 110% collateral ratio.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [liquity-v1.md](../liquity-v1.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's borrowerOperations):

```sauce chain=ethereum
import BorrowerOperationsABI from "./protocols/liquity-v1/BorrowerOperationsABI.json";

const BORROWER_OPERATIONS = 0x24179CD81c9e782A4096035f7eC97fB8B783e007n;

function main() {
  const bound = BorrowerOperationsABI.at(BORROWER_OPERATIONS);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `BorrowerOperationsABI.at(0x24179CD81c9e782A4096035f7eC97fB8B783e007n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lusd | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | no registry ABI |

## ABI

### `BorrowerOperationsABI`

`import BorrowerOperationsABI from "./protocols/liquity-v1/BorrowerOperationsABI.json";` Speaks for: borrowerOperations.

- `openTrove(uint256 _maxFeePercentage, uint256 _LUSDAmount, address _upperHint, address _lowerHint) payable`
- `closeTrove()`
- `adjustTrove(uint256 _maxFeePercentage, uint256 _collWithdrawal, uint256 _LUSDChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable`
- `repayLUSD(uint256 _LUSDAmount, address _upperHint, address _lowerHint)`
