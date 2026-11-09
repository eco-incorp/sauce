<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

High-performance options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Aevo` on ethereum |
| Chains | ethereum |
| Document | [aevo.md](../aevo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Aevo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's depositContract, `0x4082C9647c098a6493fb499EaE63b5ce3259c574`.
  require(Aevo.DepositContract != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | depositContract | `0x4082C9647c098a6493fb499EaE63b5ce3259c574` | `Aevo.DepositContract` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Aevo` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `bridgeERC20(address _localToken, address _remoteToken, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `bridgeERC20To(address _localToken, address _remoteToken, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `bridgeETH(uint32 _minGasLimit, bytes _extraData) payable`
- `bridgeETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable`
- `depositERC20(address l1Token, address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)`
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)`
- `depositETH(uint32 minGasLimit, bytes extraData) payable`
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
