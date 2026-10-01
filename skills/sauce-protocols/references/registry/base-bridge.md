<!-- Generated from the SDK's registries. Do not edit. -->

# Base Native Bridge (`base-bridge`)

Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base (OP Stack). 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, base |
| Document | [base-bridge.md](../base-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1StandardBridge):

```sauce chain=ethereum
import BaseL1StandardBridgeABI from "./protocols/base-bridge/BaseL1StandardBridgeABI.json";

const L1_STANDARD_BRIDGE = 0x3154Cf16ccdb4C6d922629664174b904d80F2C35n;

function main() {
  const bound = BaseL1StandardBridgeABI.at(L1_STANDARD_BRIDGE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` | `BaseL1StandardBridgeABI.at(0x3154Cf16ccdb4C6d922629664174b904d80F2C35n)` |
| [Base](../../../sauce-chains/references/base.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | no registry ABI |

## ABI

### `BaseL1StandardBridgeABI`

`import BaseL1StandardBridgeABI from "./protocols/base-bridge/BaseL1StandardBridgeABI.json";` Speaks for: l1StandardBridge.

- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
