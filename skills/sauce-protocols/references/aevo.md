# Aevo

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

## Category

options | Chains: Ethereum (deposits)

## Key Operations

- **depositERC20**: Deposit ERC-20 tokens into Aevo L2 for trading

## SDK Usage

```typescript
import { protocolInfo, deployments, depositERC20 } from "@eco-incorp/sauce/protocols/aevo";
```

## SauceScript Examples

```typescript
// Deposit ERC-20 into Aevo
import { DepositContractABI as IDeposit } from "./abis";
function main(
  depositAddress: Address,
  token: Address,
  l2Token: Address,
  amount: Uint256,
  minGasLimit: Uint256,
): Uint256 {
  const deposit = IDeposit.at(depositAddress);
  deposit.depositERC20(token, l2Token, amount, minGasLimit, "");
  return 1;
}
```

## Key Addresses

| Chain    | Contract        | Address                                      |
| -------- | --------------- | -------------------------------------------- |
| Ethereum | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` |

## ABI Methods

### DepositContractABI

The deposit contract is Aevo's OP Stack `L1StandardBridge`, so these are the standard bridge entry points.

- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)` - Deposit ERC-20 tokens to Aevo L2. `l2Token` is the token's Aevo L2 counterpart; `minGasLimit` is the L2 execution gas. Approve token to depositContract first
- `depositETH(uint32 minGasLimit, bytes extraData)` - Deposit ETH to Aevo L2. Payable (send ETH as msg.value)

## Notes

- Custom OP Stack rollup with off-chain orderbook for sub-second matching
- Supports options and perpetual futures trading
- Deposits are on Ethereum L1, trading happens on Aevo L2
- Withdrawals processed by the rollup bridge (takes ~7 days for L2 to L1)
- Approve ERC-20 tokens to depositContract before calling depositERC20
