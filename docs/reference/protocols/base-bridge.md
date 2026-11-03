<!-- Generated from the SDK's registries. Do not edit. -->

# Base Native Bridge (`base-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Base Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base. OP Stack architecture with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `BaseBridge` on ethereum, base |
| Chains | ethereum, base |

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use the L2StandardBridge on Base (takes 7 days)
- OP Stack architecture -- same bridge pattern as Optimism, Mode, Zora
- `depositETH` / `depositERC20` are for an externally owned account only: called from a contract, a Pot included, they revert with "StandardBridge: function can only be called from an EOA". A Sauce program uses `depositETHTo` / `depositERC20To` and names the recipient, the user's wallet unless they chose otherwise
- L1 to L2 deposits finalize in ~2-5 minutes (after L1 inclusion + sequencer processing)
- L2 to L1 withdrawals require 7-day challenge period (optimistic rollup security)
- `_l2Token` must be the official bridged token representation on Base -- incorrect L2 token address will cause deposit to fail
- Canonical bridge, secured by the Base (OP Stack) rollup itself
- L2StandardBridge is at a predefined address: `0x4200000000000000000000000000000000000010`
- Audited

## Its names in a program

On Ethereum, `BaseBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1StandardBridge, `0x3154Cf16ccdb4C6d922629664174b904d80F2C35`.
  require(BaseBridge.L1StandardBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` | `BaseBridge.L1StandardBridge` |
| [Base](../chains/base.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `BaseBridge.L2StandardBridge` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
