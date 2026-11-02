<!-- Generated from the SDK's registries. Do not edit. -->

# Wormhole (`wormhole`)

Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Wormhole` on ethereum, optimism, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |
| Document | [wormhole.md](../wormhole.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Wormhole` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's coreBridge, `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B`.
  require(Wormhole.CoreBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` | `Wormhole.CoreBridge` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` | `Wormhole.TokenBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | coreBridge | `0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722` | `Wormhole.CoreBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | tokenBridge | `0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b` | `Wormhole.TokenBridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | coreBridge | `0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7` | `Wormhole.CoreBridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | tokenBridge | `0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE` | `Wormhole.TokenBridge` |
| [Arc](../../../sauce-chains/references/arc.md) | coreBridge | `0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027` | `Wormhole.CoreBridge` |
| [Base](../../../sauce-chains/references/base.md) | coreBridge | `0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6` | `Wormhole.CoreBridge` |
| [Base](../../../sauce-chains/references/base.md) | tokenBridge | `0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627` | `Wormhole.TokenBridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` | `Wormhole.CoreBridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` | `Wormhole.TokenBridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | coreBridge | `0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c` | `Wormhole.CoreBridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | tokenBridge | `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052` | `Wormhole.TokenBridge` |

## ABI

### `WormholeCoreBridgeABI`

`import WormholeCoreBridgeABI from "./protocols/wormhole/WormholeCoreBridgeABI.json";` Speaks for: coreBridge. The import is the contract's full ABI across every deployment; call it through the `Wormhole` namespace to have a function a chain's deployment does not run refused.

- `chainId() view returns (uint16)`
- `evmChainId() view returns (uint256)`
- `getCurrentGuardianSetIndex() view returns (uint32)`
- `getGuardianSet(uint32 index) view returns ((address[] keys, uint32 expirationTime))`
- `getGuardianSetExpiry() view returns (uint32)`
- `governanceActionIsConsumed(bytes32 hash) view returns (bool)`
- `governanceChainId() view returns (uint16)`
- `governanceContract() view returns (bytes32)`
- `initialize()`
- `isFork() view returns (bool)`
- `isInitialized(address impl) view returns (bool)`
- `messageFee() view returns (uint256)`
- `nextSequence(address emitter) view returns (uint64)`
- `parseAndVerifyVM(bytes encodedVM) view returns ((uint8 version, uint32 timestamp, uint32 nonce, uint16 emitterChainId, bytes32 emitterAddress, uint64 sequence, uint8 consistencyLevel, bytes payload, uint32 guardianSetIndex, (bytes32 r, bytes32 s, uint8 v, uint8 guardianIndex)[] signatures, bytes32 hash) vm, bool valid, string reason)`
- `parseContractUpgrade(bytes encodedUpgrade) pure returns ((bytes32 module, uint8 action, uint16 chain, address newContract) cu)`
- `parseGuardianSetUpgrade(bytes encodedUpgrade) pure returns ((bytes32 module, uint8 action, uint16 chain, (address[] keys, uint32 expirationTime) newGuardianSet, uint32 newGuardianSetIndex) gsu)`
- `parseRecoverChainId(bytes encodedRecoverChainId) pure returns ((bytes32 module, uint8 action, uint256 evmChainId, uint16 newChainId) rci)`
- `parseSetMessageFee(bytes encodedSetMessageFee) pure returns ((bytes32 module, uint8 action, uint16 chain, uint256 messageFee) smf)`
- `parseTransferFees(bytes encodedTransferFees) pure returns ((bytes32 module, uint8 action, uint16 chain, uint256 amount, bytes32 recipient) tf)`
- `parseVM(bytes encodedVM) pure returns ((uint8 version, uint32 timestamp, uint32 nonce, uint16 emitterChainId, bytes32 emitterAddress, uint64 sequence, uint8 consistencyLevel, bytes payload, uint32 guardianSetIndex, (bytes32 r, bytes32 s, uint8 v, uint8 guardianIndex)[] signatures, bytes32 hash) vm)`
- `publishMessage(uint32 nonce, bytes payload, uint8 consistencyLevel) payable returns (uint64 sequence)`
- `quorum(uint256 numGuardians) pure returns (uint256 numSignaturesRequiredForQuorum)`
- `submitContractUpgrade(bytes _vm)`
- `submitNewGuardianSet(bytes _vm)`
- `submitRecoverChainId(bytes _vm)`
- `submitSetMessageFee(bytes _vm)`
- `submitTransferFees(bytes _vm)`
- `verifySignatures(bytes32 hash, (bytes32 r, bytes32 s, uint8 v, uint8 guardianIndex)[] signatures, (address[] keys, uint32 expirationTime) guardianSet) pure returns (bool valid, string reason)`
- `verifyVM((uint8 version, uint32 timestamp, uint32 nonce, uint16 emitterChainId, bytes32 emitterAddress, uint64 sequence, uint8 consistencyLevel, bytes payload, uint32 guardianSetIndex, (bytes32 r, bytes32 s, uint8 v, uint8 guardianIndex)[] signatures, bytes32 hash) vm) view returns (bool valid, string reason)`

Left out of this ABI, though its deployments declare them:

- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event GuardianSetAdded` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `WormholeTokenBridgeABI`

`import WormholeTokenBridgeABI from "./protocols/wormhole/WormholeTokenBridgeABI.json";` Speaks for: tokenBridge. The import is the contract's full ABI across every deployment; call it through the `Wormhole` namespace to have a function a chain's deployment does not run refused.

- `_parseTransferCommon(bytes encoded) pure returns ((uint8 payloadID, uint256 amount, bytes32 tokenAddress, uint16 tokenChain, bytes32 to, uint16 toChain, uint256 fee) transfer)`
- `attestToken(address tokenAddress, uint32 nonce) payable returns (uint64 sequence)`
- `bridgeContracts(uint16 chainId_) view returns (bytes32)`
- `chainId() view returns (uint16)`
- `completeTransfer(bytes encodedVm)`
- `completeTransferAndUnwrapETH(bytes encodedVm)`
- `completeTransferAndUnwrapETHWithPayload(bytes encodedVm) returns (bytes)`
- `completeTransferWithPayload(bytes encodedVm) returns (bytes)`
- `createWrapped(bytes encodedVm) returns (address token)`
- `encodeAssetMeta((uint8 payloadID, bytes32 tokenAddress, uint16 tokenChain, uint8 decimals, bytes32 symbol, bytes32 name) meta) pure returns (bytes encoded)`
- `encodeTransfer((uint8 payloadID, uint256 amount, bytes32 tokenAddress, uint16 tokenChain, bytes32 to, uint16 toChain, uint256 fee) transfer) pure returns (bytes encoded)`
- `encodeTransferWithPayload((uint8 payloadID, uint256 amount, bytes32 tokenAddress, uint16 tokenChain, bytes32 to, uint16 toChain, bytes32 fromAddress, bytes payload) transfer) pure returns (bytes encoded)`
- `evmChainId() view returns (uint256)`
- `finality() view returns (uint8)`
- `governanceActionIsConsumed(bytes32 hash) view returns (bool)`
- `governanceChainId() view returns (uint16)`
- `governanceContract() view returns (bytes32)`
- `implementation() view returns (address)`
- `initialize()`
- `isFork() view returns (bool)`
- `isInitialized(address impl) view returns (bool)`
- `isTransferCompleted(bytes32 hash) view returns (bool)`
- `isWrappedAsset(address token) view returns (bool)`
- `outstandingBridged(address token) view returns (uint256)`
- `parseAssetMeta(bytes encoded) pure returns ((uint8 payloadID, bytes32 tokenAddress, uint16 tokenChain, uint8 decimals, bytes32 symbol, bytes32 name) meta)`
- `parsePayloadID(bytes encoded) pure returns (uint8 payloadID)`
- `parseRecoverChainId(bytes encodedRecoverChainId) pure returns ((bytes32 module, uint8 action, uint256 evmChainId, uint16 newChainId) rci)`
- `parseRegisterChain(bytes encoded) pure returns ((bytes32 module, uint8 action, uint16 chainId, uint16 emitterChainID, bytes32 emitterAddress) chain)`
- `parseTransfer(bytes encoded) pure returns ((uint8 payloadID, uint256 amount, bytes32 tokenAddress, uint16 tokenChain, bytes32 to, uint16 toChain, uint256 fee) transfer)`
- `parseTransferWithPayload(bytes encoded) pure returns ((uint8 payloadID, uint256 amount, bytes32 tokenAddress, uint16 tokenChain, bytes32 to, uint16 toChain, bytes32 fromAddress, bytes payload) transfer)`
- `parseUpgrade(bytes encoded) pure returns ((bytes32 module, uint8 action, uint16 chainId, bytes32 newContract) chain)`
- `registerChain(bytes encodedVM)`
- `submitRecoverChainId(bytes encodedVM)`
- `tokenImplementation() view returns (address)`
- `transferTokens(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint256 arbiterFee, uint32 nonce) payable returns (uint64 sequence)`
- `transferTokensWithPayload(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint32 nonce, bytes payload) payable returns (uint64 sequence)`
- `updateWrapped(bytes encodedVm) returns (address token)`
- `upgrade(bytes encodedVM)`
- `WETH() view returns (address)`
- `wormhole() view returns (address)`
- `wrapAndTransferETH(uint16 recipientChain, bytes32 recipient, uint256 arbiterFee, uint32 nonce) payable returns (uint64 sequence)`
- `wrapAndTransferETHWithPayload(uint16 recipientChain, bytes32 recipient, uint32 nonce, bytes payload) payable returns (uint64 sequence)`
- `wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) view returns (address)`

Left out of this ABI, though its deployments declare them:

- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
