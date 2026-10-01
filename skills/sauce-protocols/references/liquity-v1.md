# Liquity V1

Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with minimum 110% collateral ratio.

## Category

cdp | Chains: Ethereum

## Key Operations

- **closeTrove**: Close an existing Trove (repay all debt and withdraw collateral)
- **repayLUSD**: Repay LUSD debt on an open Trove
- **openTrove**: Open a new Trove by depositing ETH and borrowing LUSD
- **adjustTrove**: Adjust Trove collateral and/or debt

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  closeTrove,
  repayLUSD,
} from "@eco-incorp/sauce/protocols/liquity-v1";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract           | Address                                      |
| -------- | ------------------ | -------------------------------------------- |
| Ethereum | lusd               | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` |
| Ethereum | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` |

## ABI Methods

### BorrowerOperationsABI

- `openTrove(uint256,uint256,address,address)` - Open new Trove. Payable (send ETH as collateral). Params: maxFeePercentage (max borrowing fee, e.g. 5e16 = 5%), LUSDAmount (LUSD to borrow), upperHint (sorted troves hint), lowerHint (sorted troves hint)
- `closeTrove()` - Close Trove. Must repay all LUSD debt first. Returns all ETH collateral
- `adjustTrove(uint256,uint256,uint256,bool,address,address)` - Adjust Trove. Payable (send ETH to add collateral). Params: maxFeePercentage, collWithdrawal (ETH to withdraw), LUSDChange (LUSD amount to change), isDebtIncrease (true=borrow more, false=repay), upperHint, lowerHint
- `repayLUSD(uint256,address,address)` - Repay LUSD debt. Params: LUSDAmount, upperHint, lowerHint (sorted-trove hints; the zero address is valid)

## Notes

- TVL: $500M+. Interest-free loans with one-time borrowing fee (0.5% - 5%)
- Minimum collateral ratio: 110%. Below this, Trove can be liquidated
- Hint addresses (upperHint, lowerHint) optimize sorted trove list insertion - use Liquity frontend SDK to compute
- Minimum debt: 2000 LUSD (including 200 LUSD gas reserve)
- closeTrove requires repaying all debt including the 200 LUSD gas reserve
