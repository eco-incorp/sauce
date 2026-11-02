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

`import BaseL1StandardBridgeABI from "./protocols/base-bridge/BaseL1StandardBridgeABI.json";` Speaks for: l1StandardBridge. The import is the contract's full ABI across every deployment; call it through the `BaseBridge` namespace to have a function a chain's deployment does not run refused.

- `bridgeERC20(address _localToken, address _remoteToken, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `bridgeERC20To(address _localToken, address _remoteToken, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `bridgeETH(uint32 _minGasLimit, bytes _extraData) payable`
- `bridgeETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETH(uint32 _minGasLimit, bytes _extraData) payable`
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `deposits(address, address) view returns (uint256)`
- `finalizeBridgeERC20(address _localToken, address _remoteToken, address _from, address _to, uint256 _amount, bytes _extraData)`
- `finalizeBridgeETH(address _from, address _to, uint256 _amount, bytes _extraData) payable`
- `finalizeERC20Withdrawal(address _l1Token, address _l2Token, address _from, address _to, uint256 _amount, bytes _extraData)`
- `finalizeETHWithdrawal(address _from, address _to, uint256 _amount, bytes _extraData) payable`
- `initialize(address _messenger, address _systemConfig)`
- `initVersion() view returns (uint8)`
- `l2TokenBridge() view returns (address)`
- `messenger() view returns (address)`
- `MESSENGER() view returns (address)`
- `OTHER_BRIDGE() view returns (address)`
- `otherBridge() view returns (address)`
- `paused() view returns (bool)`
- `proxyAdmin() view returns (address)`
- `proxyAdminOwner() view returns (address)`
- `superchainConfig() view returns (address)`
- `systemConfig() view returns (address)`
- `version() view returns (string)`

Left out of this ABI, though its deployments declare them:

- `error ProxyAdminOwnedBase_NotProxyAdmin` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ProxyAdminOwnedBase_NotProxyAdminOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ProxyAdminOwnedBase_NotSharedProxyAdminOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReinitializableBase_ZeroInitVersion` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
