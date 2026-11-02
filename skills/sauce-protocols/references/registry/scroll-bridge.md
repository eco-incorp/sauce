<!-- Generated from the SDK's registries. Do not edit. -->

# Scroll Native Bridge (`scroll-bridge`)

Official Scroll zkEVM bridge via L1ScrollMessenger. Deposits ETH and ERC-20 tokens with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ScrollBridge` on ethereum, scroll |
| Chains | ethereum, scroll |
| Document | [scroll-bridge.md](../scroll-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `ScrollBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1GatewayRouter, `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6`.
  require(ScrollBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2GatewayRouter | `0x4C0926FF5252A435FD19e10ED15e5a249Ba19d79` | `ScrollBridge.L2GatewayRouter` |
| [Scroll](../../../sauce-chains/references/scroll.md) | l2ScrollMessenger | `0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC` | `ScrollBridge.L2ScrollMessenger` |

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
