<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll Native Bridge (`scroll-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Scroll Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Scroll zkEVM bridge via L1ScrollMessenger and L1GatewayRouter. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ScrollBridge` on ethereum, scroll |
| Chains | ethereum, scroll |

## Notes

- **L1 to L2** via GatewayRouter (for token deposits) or L1ScrollMessenger (for arbitrary messages)
- zkEVM architecture -- withdrawals finalize with ZK proofs (faster than optimistic rollups, typically hours not days)
- GatewayRouter auto-routes tokens to the correct gateway (standard ERC-20, WETH, custom gateways)
- `msg.value` must include gas fees for L2 execution (even for ERC-20 deposits)
- L1 to L2 deposits finalize after ZK proof generation (~1-4 hours)
- L2 to L1 withdrawals also require ZK proof finalization (~1-4 hours)
- Canonical bridge, secured by Scroll's ZK proving system
- Audited

## Its names in a program

On Ethereum, `ScrollBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1GatewayRouter, `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6`.
  require(ScrollBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Ethereum](../chains/ethereum.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Scroll](../chains/scroll.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll](../chains/scroll.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |

## ABI

### `ScrollL1GatewayRouterABI`

`import ScrollL1GatewayRouterABI from "./protocols/scroll-bridge/ScrollL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `defaultERC20Gateway() view returns (address)`
- `depositERC20(address _token, uint256 _amount, uint256 _gasLimit) payable`
- `depositERC20(address _token, address _to, uint256 _amount, uint256 _gasLimit) payable`
- `depositERC20AndCall(address _token, address _to, uint256 _amount, bytes _data, uint256 _gasLimit) payable`
- `depositETH(uint256 _amount, uint256 _gasLimit) payable`
- `depositETH(address _to, uint256 _amount, uint256 _gasLimit) payable`
- `depositETHAndCall(address _to, uint256 _amount, bytes _data, uint256 _gasLimit) payable`
- `ERC20Gateway(address) view returns (address)`
- `ethGateway() view returns (address)`
- `finalizeWithdrawERC20(address, address, address, address, uint256, bytes) payable`
- `finalizeWithdrawETH(address, address, uint256, bytes) payable`
- `gatewayInContext() view returns (address)`
- `getERC20Gateway(address _token) view returns (address)`
- `getL2ERC20Address(address _l1Address) view returns (address)`
- `initialize(address _ethGateway, address _defaultERC20Gateway)`
- `owner() view returns (address)`
- `renounceOwnership()`
- `requestERC20(address _sender, address _token, uint256 _amount) returns (uint256)`
- `setDefaultERC20Gateway(address _newDefaultERC20Gateway)`
- `setERC20Gateway(address[] _tokens, address[] _gateways)`
- `setETHGateway(address _newEthGateway)`
- `transferOwnership(address newOwner)`

### `ScrollL1MessengerABI`

`import ScrollL1MessengerABI from "./protocols/scroll-bridge/ScrollL1MessengerABI.json";` Speaks for: l1ScrollMessenger.

- `counterpart() view returns (address)`
- `enforcedTxGateway() view returns (address)`
- `feeVault() view returns (address)`
- `initialize(address _counterpart, address _feeVault, address _rollup, address _messageQueue)`
- `isL2MessageExecuted(bytes32) view returns (bool)`
- `messageQueueV1() view returns (address)`
- `messageQueueV2() view returns (address)`
- `messageSendTimestamp(bytes32) view returns (uint256)`
- `owner() view returns (address)`
- `paused() view returns (bool)`
- `prevReplayIndex(uint256) view returns (uint256)`
- `relayMessageWithProof(address _from, address _to, uint256 _value, uint256 _nonce, bytes _message, (uint256 batchIndex, bytes merkleProof) _proof)`
- `renounceOwnership()`
- `replayMessage(address _from, address _to, uint256 _value, uint256 _messageNonce, bytes _message, uint32 _newGasLimit, address _refundAddress) payable`
- `replayStates(bytes32) view returns (uint128 times, uint128 lastIndex)`
- `rollup() view returns (address)`
- `sendMessage(address to, uint256 value, bytes message, uint256 gasLimit) payable`
- `sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, address _refundAddress) payable`
- `setPause(bool _status)`
- `transferOwnership(address newOwner)`
- `updateFeeVault(address _newFeeVault)`
- `xDomainMessageSender() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
