# EigenLayer

Restaking protocol that enables staked ETH to secure additional protocols (AVS). Deposit LSTs into strategies to earn restaking rewards on top of staking yield.

## Category

restaking | Chains: Ethereum

## Key Operations

- **depositIntoStrategy**: Deposit LSTs (stETH, rETH, cbETH) into a restaking strategy
- **delegateTo**: Delegate restaked assets to an operator (via DelegationManager)
- **undelegate**: Undelegate from an operator, initiating withdrawal

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  depositIntoStrategy,
} from "@eco-incorp/sauce/protocols/eigenlayer";
```

## SauceScript Examples

```typescript
// Deposit LST into restaking strategy
import { StrategyManagerABI as IStrategyManager } from "./abis";
function main(
  strategyManagerAddress: Address,
  strategy: Address,
  token: Address,
  amount: Uint256,
): Uint256 {
  const sm = IStrategyManager.at(strategyManagerAddress);
  return sm.depositIntoStrategy(strategy, token, amount);
}
```

## Key Addresses

| Chain    | Contract          | Address                                      |
| -------- | ----------------- | -------------------------------------------- |
| Ethereum | strategyManager   | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` |
| Ethereum | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` |
| Ethereum | stETHStrategy     | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` |
| Ethereum | rETHStrategy      | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` |
| Ethereum | cbETHStrategy     | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` |

## ABI Methods

### StrategyManagerABI

- `depositIntoStrategy(address,address,uint256)` - Deposit token into strategy. Params: strategy address, token address, amount. Returns shares
- `stakerDepositShares(address staker, address strategy)` - Query staker's deposit shares in a strategy (renamed from `stakerStrategyShares`)

### DelegationManagerABI

- `delegateTo(address,tuple,bytes32)` - Delegate to operator. Tuple is (signature bytes, expiry uint256). Use empty sig + max expiry
- `undelegate(address)` - Undelegate staker. Returns withdrawal root bytes32[]
- `isDelegated(address)` - Check if address is delegated to an operator

### StrategyABI

- `sharesToUnderlyingView(uint256)` - Convert shares to underlying token amount
- `underlyingToSharesView(uint256)` - Convert underlying amount to shares

## Notes

- TVL: $13B+. Foundation of the restaking ecosystem
- Approve LST token to StrategyManager before depositing
- Each LST has its own strategy contract (stETH, rETH, cbETH listed above)
- Withdrawal has a 7-day delay period after undelegating
- delegateTo requires approverSignatureAndExpiry tuple - use empty bytes + far-future expiry for typical cases
