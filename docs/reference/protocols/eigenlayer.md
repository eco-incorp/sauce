<!-- Generated from the SDK's registries. Do not edit. -->

# EigenLayer (`eigenlayer`)

> EigenLayer is a restaking protocol: staked coins put to work securing other services too. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Restaking protocol that enables staked ETH to secure additional protocols (AVS). Deposit LSTs into strategies to earn restaking rewards on top of staking yield.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Eigenlayer` on ethereum |
| Chains | ethereum |

## Key Operations

- **depositIntoStrategy**: Deposit LSTs (stETH, rETH, cbETH) into a restaking strategy
- **delegateTo**: Delegate restaked assets to an operator (via DelegationManager)
- **undelegate**: Undelegate from an operator, initiating withdrawal

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- TVL: $13B+. Foundation of the restaking ecosystem
- Approve LST token to StrategyManager before depositing
- Each LST has its own strategy contract (stETH, rETH, cbETH listed above)
- Withdrawal has a 7-day delay period after undelegating
- delegateTo requires approverSignatureAndExpiry tuple - use empty bytes + far-future expiry for typical cases

## Its names in a program

On Ethereum, `Eigenlayer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cbETHStrategy, `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc`.
  require(Eigenlayer.CbETHStrategy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `Eigenlayer.CbETHStrategy` |
| [Ethereum](../chains/ethereum.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `Eigenlayer.DelegationManager` |
| [Ethereum](../chains/ethereum.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `Eigenlayer.RETHStrategy` |
| [Ethereum](../chains/ethereum.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `Eigenlayer.StETHStrategy` |
| [Ethereum](../chains/ethereum.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `Eigenlayer.StrategyManager` |

## ABI

### `DelegationManagerABI`

`import DelegationManagerABI from "./protocols/eigenlayer/DelegationManagerABI.json";` Speaks for: delegationManager.

- `delegateTo(address operator, (bytes signature, uint256 expiry) approverSignatureAndExpiry, bytes32 approverSalt)`
- `undelegate(address staker) returns (bytes32[] withdrawalRoots)`
- `isDelegated(address staker) view returns (bool)`

### `StrategyABI`

`import StrategyABI from "./protocols/eigenlayer/StrategyABI.json";` Speaks for: stETHStrategy, rETHStrategy, cbETHStrategy.

- `sharesToUnderlyingView(uint256 amountShares) view returns (uint256)`
- `underlyingToSharesView(uint256 amountUnderlying) view returns (uint256)`

### `StrategyManagerABI`

`import StrategyManagerABI from "./protocols/eigenlayer/StrategyManagerABI.json";` Speaks for: strategyManager.

- `depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)`
- `stakerDepositShares(address staker, address strategy) view returns (uint256 shares)`
