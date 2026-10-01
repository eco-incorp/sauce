<!-- Generated from the SDK's registries. Do not edit. -->

# Optimism Native Bridge (`optimism-bridge`)

Official Optimism L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Optimism with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism |
| Document | [optimism-bridge.md](../optimism-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1StandardBridge):

```sauce chain=ethereum
import OptimismL1StandardBridgeABI from "./protocols/optimism-bridge/OptimismL1StandardBridgeABI.json";

const L1_STANDARD_BRIDGE = 0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1n;

function main() {
  const bound = OptimismL1StandardBridgeABI.at(L1_STANDARD_BRIDGE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | `OptimismL1StandardBridgeABI.at(0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | no registry ABI |

## ABI

### `OptimismL1StandardBridgeABI`

`import OptimismL1StandardBridgeABI from "./protocols/optimism-bridge/OptimismL1StandardBridgeABI.json";` Speaks for: l1StandardBridge.

- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
