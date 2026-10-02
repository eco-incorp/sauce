<!-- Generated from the SDK's registries. Do not edit. -->

# Optimism Native Bridge (`optimism-bridge`)

Official Optimism L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Optimism with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `OptimismBridge` on ethereum, optimism |
| Chains | ethereum, optimism |
| Document | [optimism-bridge.md](../optimism-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `OptimismBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1StandardBridge, `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1`.
  require(OptimismBridge.L1StandardBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | `OptimismBridge.L1StandardBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `OptimismBridge.L2StandardBridge` |

## ABI

### `OptimismL1StandardBridgeABI`

`import OptimismL1StandardBridgeABI from "./protocols/optimism-bridge/OptimismL1StandardBridgeABI.json";` Speaks for: l1StandardBridge.

- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
