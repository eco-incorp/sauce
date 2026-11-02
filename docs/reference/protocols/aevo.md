<!-- Generated from the SDK's registries. Do not edit. -->

# Aevo (`aevo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aevo is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Options and perpetuals exchange built on a custom OP Stack rollup. Off-chain orderbook with on-chain settlement.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Aevo` on ethereum |
| Chains | ethereum |

## What it offers

- **depositERC20**: Deposit ERC-20 tokens into Aevo L2 for trading

## Notes

- Custom OP Stack rollup with off-chain orderbook for sub-second matching
- Supports options and perpetual futures trading
- Deposits are on Ethereum L1, trading happens on Aevo L2
- Withdrawals processed by the rollup bridge (takes ~7 days for L2 to L1)
- Approve ERC-20 tokens to depositContract before calling depositERC20
- The deposit contract is Aevo's OP Stack `L1StandardBridge`, so these are the standard bridge entry points.
- `depositERC20` and `depositETH` are for an externally owned account only: called from a contract, a Pot included, they revert with "StandardBridge: function can only be called from an EOA", so a Sauce program cannot deposit with `depositERC20`. The bridge's `depositERC20To(l1Token, l2Token, to, amount, minGasLimit, extraData)` takes a contract caller; the registry's ABI for Aevo does not declare it, so a program binds an ABI of its own for it

## Its names in a program

On Ethereum, `Aevo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's depositContract, `0x4082C9647c098a6493fb499EaE63b5ce3259c574`.
  require(Aevo.DepositContract != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | depositContract | `0x4082C9647c098a6493fb499EaE63b5ce3259c574` | `Aevo.DepositContract` |

## ABI

### `DepositContractABI`

`import DepositContractABI from "./protocols/aevo/DepositContractABI.json";` Speaks for: depositContract. The import is the contract's full ABI across every deployment; call it through the `Aevo` namespace to have a function a chain's deployment does not run refused.

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
