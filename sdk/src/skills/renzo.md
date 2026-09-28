# Renzo

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a non-rebasing liquid restaked token.

## Category

restaking | Chains: Ethereum

## Key Operations

- **depositETH**: Deposit ETH directly to receive ezETH
- **deposit**: Deposit LST collateral (stETH, etc.) to receive ezETH

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/renzo";
```

## SauceScript Examples

```typescript
// Deposit ETH for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.depositETH();
  return 1;
}

// Deposit LST for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address, collateralToken: Address, amount: Uint256): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.deposit(collateralToken, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Ethereum | ezETH          | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` |
| Ethereum | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` |

## ABI Methods

### RestakeManagerABI

- `deposit(address,uint256)` - Deposit LST collateral for ezETH (not payable). Approve token first
- `depositETH()` - Deposit ETH (payable) for ezETH. Send ETH as msg.value

### EzETHABI

- `balanceOf(address)` - Query ezETH balance
- `approve(address,uint256)` - Approve ezETH spending

## Notes

- TVL: $389M+. Built on EigenLayer restaking
- ezETH is non-rebasing - value accrues over time
- depositETH() is payable - send ETH as msg.value
- For LST deposits, approve the collateral token to restakeManager first
