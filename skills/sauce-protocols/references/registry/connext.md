<!-- Generated from the SDK's registries. Do not edit. -->

# Connext (Everclear) (`connext`)

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Connext` on ethereum, optimism, base, arbitrum |
| Chains | ethereum, optimism, base, arbitrum |
| Document | [connext.md](../connext.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Connext` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's everclearSpoke, `0xa05A3380889115bf313f1Db9d5f335157Be4D816`.
  require(Connext.EverclearSpoke != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Optimism](../../../sauce-chains/references/optimism.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Base](../../../sauce-chains/references/base.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |

## ABI

### `EverclearSpokeABI`

`import EverclearSpokeABI from "./protocols/connext/EverclearSpokeABI.json";` Speaks for: everclearSpoke.

- `balances(bytes32 _asset, bytes32 _user) view returns (uint256 _amount)`
- `BATCH_FILL_INTENT_TYPEHASH() view returns (bytes32)`
- `batchFillIntent((bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data)[] _intents, uint256[] _amountOut, bytes32[] _receivers, uint32[][] _destinations, bytes _signature, bool _pullFunds) returns ((bytes32 intentId, bytes32 receiver, bytes32 intentInputAsset, uint32 intentOrigin, uint256 amountOut, uint32[] destinations, uint48 executionTimestamp)[] _fillMessages)`
- `callExecutor() view returns (address)`
- `deposit(address _asset, uint256 _amount)`
- `deprecated_fillQueue() view returns (uint256 first, uint256 last)`
- `deprecated_intentQueue() view returns (uint256 first, uint256 last)`
- `DOMAIN() view returns (uint32)`
- `EVERCLEAR() view returns (uint32)`
- `executeIntentCalldata((bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) _intent)`
- `feeAdapter() view returns (address)`
- `FILL_INTENT_FOR_SOLVER_TYPEHASH() view returns (bytes32)`
- `FILL_INTENT_TYPEHASH() view returns (bytes32)`
- `fillIntent((bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) _intent, uint256 _amountOut, bytes32 _receiver, uint32[] _destinations, bytes _signature, bool _pullFunds) returns ((bytes32 intentId, bytes32 receiver, bytes32 intentInputAsset, uint32 intentOrigin, uint256 amountOut, uint32[] destinations, uint48 executionTimestamp) _fillMessage)`
- `fillQueue() view returns (uint256 first, uint256 last)`
- `fillSigner() view returns (address)`
- `gateway() view returns (address)`
- `initialize(address _feeAdapter, address _messageReceiver, address _fillSigner)`
- `intentQueue() view returns (uint256 first, uint256 last)`
- `lighthouse() view returns (address)`
- `messageGasLimit() view returns (uint256)`
- `messageReceiver() view returns (address)`
- `modules(uint8 _strategy) view returns (address _module)`
- `newIntent(uint32[] destinations, address receiver, address inputAsset, address outputAsset, uint256 amount, uint256 amountOutMin, uint48 ttl, bytes data) returns (bytes32 intentId, (bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) intent)`
- `nonce() view returns (uint64)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `PERMIT2() view returns (address)`
- `PROCESS_FILL_QUEUE_VIA_RELAYER_TYPEHASH() view returns (bytes32)`
- `PROCESS_INTENT_QUEUE_VIA_RELAYER_TYPEHASH() view returns (bytes32)`
- `processFillQueue(uint32 _amount, uint256 _dynamicGasLimit) payable`
- `processFillQueueViaRelayer(uint32 _domain, uint32 _amount, address _relayer, uint256 _ttl, uint256 _nonce, uint256 _dynamicGasLimit, bytes _signature)`
- `processIntentQueue((bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data)[] _intents, uint256 _dynamicGasLimit) payable`
- `processIntentQueueViaRelayer(uint32 _domain, (bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data)[] _intents, address _relayer, uint256 _ttl, uint256 _nonce, uint256 _dynamicGasLimit, bytes _signature)`
- `proxiableUUID() view returns (bytes32)`
- `receiveMessage(bytes)`
- `renounceOwnership()`
- `setModuleForStrategy(uint8 _strategy, address _module)`
- `setStrategyForAsset(address _asset, uint8 _strategy)`
- `status(bytes32 _intentId) view returns (uint8 status)`
- `strategies(address _asset) view returns (uint8 _strategy)`
- `transferOwnership(address newOwner)`
- `unpause()`
- `updateFeeAdapter(address _feeAdapter)`
- `updateFillSigner(address _feeSigner)`
- `updateGateway(address _newGateway)`
- `updateMessageGasLimit(uint256 _newGasLimit)`
- `updateMessageReceiver(address _newMessageReceiver)`
- `updateSecurityModule(address _newSecurityModule)`
- `UPGRADE_INTERFACE_VERSION() view returns (string)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `watchtower() view returns (address)`
- `withdraw(address _asset, uint256 _amount)`
- `withdrawTokens(address[] _tokens, address _recipient)`

Left out of this ABI, though its deployments declare them:

- `newIntent` taking `(uint32[],bytes32,address,bytes32,uint256,uint256,uint48,bytes)`: an overload of newIntent(uint32[],address,address,address,uint256,uint256,uint48,bytes), which takes as many arguments: a call picks its overload by argument count.
