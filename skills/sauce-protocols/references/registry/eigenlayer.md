<!-- Generated from the SDK's registries. Do not edit. -->

# EigenLayer (`eigenlayer`)

Restaking protocol that enables staked ETH to secure additional protocols. Deposit LSTs into strategies to earn restaking rewards.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Eigenlayer` on ethereum |
| Chains | ethereum |
| Document | [eigenlayer.md](../eigenlayer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Eigenlayer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cbETHStrategy, `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc`.
  require(Eigenlayer.CbETHStrategy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `Eigenlayer.CbETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `Eigenlayer.DelegationManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `Eigenlayer.RETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `Eigenlayer.StETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `Eigenlayer.StrategyManager` |

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
