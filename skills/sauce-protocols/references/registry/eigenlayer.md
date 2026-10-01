<!-- Generated from the SDK's registries. Do not edit. -->

# EigenLayer (`eigenlayer`)

Restaking protocol that enables staked ETH to secure additional protocols. Deposit LSTs into strategies to earn restaking rewards.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [eigenlayer.md](../eigenlayer.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's cbETHStrategy):

```sauce chain=ethereum
import StrategyABI from "./protocols/eigenlayer/StrategyABI.json";

const CB_ETHSTRATEGY = 0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bcn;

function main() {
  const bound = StrategyABI.at(CB_ETHSTRATEGY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `StrategyABI.at(0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bcn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `DelegationManagerABI.at(0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37An)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `StrategyABI.at(0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `StrategyABI.at(0x93c4b944D05dfe6df7645A86cd2206016c51564Dn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `StrategyManagerABI.at(0x858646372CC42E1A627fcE94aa7A7033e7CF075An)` |

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
