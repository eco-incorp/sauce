<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V1 (`liquity-v1`)

Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with minimum 110% collateral ratio.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV1` on ethereum |
| Chains | ethereum |

## Key Operations

- **closeTrove**: Close an existing Trove (repay all debt and withdraw collateral)
- **repayLUSD**: Repay LUSD debt on an open Trove
- **openTrove**: Open a new Trove by depositing ETH and borrowing LUSD
- **adjustTrove**: Adjust Trove collateral and/or debt

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Close Trove
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";
function main(borrowerOpsAddress: Address): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.closeTrove();
  return 1;
}

// Repay LUSD debt
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";
function main(borrowerOpsAddress: Address, amount: Uint256): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.repayLUSD(
    amount,
    0x0000000000000000000000000000000000000000,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}
```

## Notes

- TVL: $500M+. Interest-free loans with one-time borrowing fee (0.5% - 5%)
- Minimum collateral ratio: 110%. Below this, Trove can be liquidated
- Hint addresses (upperHint, lowerHint) optimize sorted trove list insertion - use Liquity frontend SDK to compute
- Minimum debt: 2000 LUSD (including 200 LUSD gas reserve)
- closeTrove requires repaying all debt including the 200 LUSD gas reserve

## Its names in a program

On Ethereum, `LiquityV1` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's borrowerOperations, `0x24179CD81c9e782A4096035f7eC97fB8B783e007`.
  require(LiquityV1.BorrowerOperations != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `LiquityV1.BorrowerOperations` |
| [Ethereum](../chains/ethereum.md) | lusd | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | `LiquityV1.Lusd` |

## ABI

### `BorrowerOperationsABI`

`import BorrowerOperationsABI from "./protocols/liquity-v1/BorrowerOperationsABI.json";` Speaks for: borrowerOperations.

- `openTrove(uint256 _maxFeePercentage, uint256 _LUSDAmount, address _upperHint, address _lowerHint) payable`
- `closeTrove()`
- `adjustTrove(uint256 _maxFeePercentage, uint256 _collWithdrawal, uint256 _LUSDChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable`
- `repayLUSD(uint256 _LUSDAmount, address _upperHint, address _lowerHint)`
