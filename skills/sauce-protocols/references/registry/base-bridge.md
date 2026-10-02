<!-- Generated from the SDK's registries. Do not edit. -->

# Base Native Bridge (`base-bridge`)

Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base (OP Stack). 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `BaseBridge` on ethereum, base |
| Chains | ethereum, base |
| Document | [base-bridge.md](../base-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `BaseBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1StandardBridge, `0x3154Cf16ccdb4C6d922629664174b904d80F2C35`.
  require(BaseBridge.L1StandardBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` | `BaseBridge.L1StandardBridge` |
| [Base](../../../sauce-chains/references/base.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `BaseBridge.L2StandardBridge` |

## ABI

### `BaseL1StandardBridgeABI`

`import BaseL1StandardBridgeABI from "./protocols/base-bridge/BaseL1StandardBridgeABI.json";` Speaks for: l1StandardBridge.

- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
