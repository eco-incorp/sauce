<!-- Generated from the SDK's registries. Do not edit. -->

# Connext (Everclear) (`connext`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Connext (Everclear) is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Connext` on ethereum, optimism, base, arbitrum |
| Chains | ethereum, optimism, base, arbitrum |

## Notes

- Intent-based architecture: users express desired outcome, solvers compete to fill
- Rebranded from Connext to Everclear -- same contracts
- Same EverclearSpoke address deployed across all chains
- Uses domain IDs (uint32) for destination chains, NOT EVM chain IDs
- Supports cross-chain swaps (inputAsset != outputAsset)
- `ttl` determines how long the intent is valid -- unfilled intents can be cancelled after expiry
- Finality: typically 2-15 minutes depending on solver activity
- Requires ERC-20 approval to the EverclearSpoke
- TVL: $50M+. Audited

## Its names in a program

On Ethereum, `Connext` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's everclearSpoke, `0xa05A3380889115bf313f1Db9d5f335157Be4D816`.
  require(Connext.EverclearSpoke != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Optimism](../chains/optimism.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Base](../chains/base.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Arbitrum One](../chains/arbitrum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |

## ABI

### `EverclearSpokeABI`

`import EverclearSpokeABI from "./protocols/connext/EverclearSpokeABI.json";` Speaks for: everclearSpoke. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Connext` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

- `error ECDSAInvalidSignatureS` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_FeeAdapter_NotAuthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_FillIntent_InsufficientFunds` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_FillIntent_IntentExpired` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_FillIntent_InvalidArrayLengths` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_FillIntent_InvalidDestinationArray` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_InvalidMessageType` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_InvalidSignature` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_InvalidVarUpdate` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_NewIntent_CalldataExceedsLimit` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_NewIntent_InvalidIntent` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_NewIntent_OutputAssetNull` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_Pause_NotAuthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_ProcessFillViaRelayer_NotRelayer` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_ProcessFillViaRelayer_TTLExpired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_ProcessQueue_InvalidAmount` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_ProcessQueue_ZeroAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EverclearSpoke_Unauthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FailedInnerCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAccountNonce` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInitializing` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnauthorizedCallContext` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnsupportedProxiableUUID` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AssetMintFailed` taking `(address,address,uint256,uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AssetTransferFailed` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event LighthouseUpdated` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Settled` taking `(bytes32,address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event WatchtowerUpdated` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `newIntent` taking `(uint32[],bytes32,address,bytes32,uint256,uint256,uint48,bytes)`: an overload of newIntent(uint32[],address,address,address,uint256,uint256,uint48,bytes), which takes as many arguments: a call picks its overload by argument count.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
