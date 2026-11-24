<!-- Generated from the SDK's registries. Do not edit. -->

# LayerZero (`layerzero`)

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Layerzero` on ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Chains | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Document | [layerzero.md](../layerzero.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Layerzero` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's endpointV2, `0x1a44076050125825900e736c501f859c50fE728c`.
  require(Layerzero.EndpointV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `Layerzero.EndpointV2` |
| [Arc](../../../sauce-chains/references/arc.md) | endpointV2 | `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | `Layerzero.EndpointV2` |
| [Base](../../../sauce-chains/references/base.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Linea](../../../sauce-chains/references/linea.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Scroll](../../../sauce-chains/references/scroll.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |

## ABI

### `LayerZeroEndpointV2ABI`

`import LayerZeroEndpointV2ABI from "./protocols/layerzero/LayerZeroEndpointV2ABI.json";` Speaks for: endpointV2. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Layerzero` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `blockedLibrary() view returns (address)`
- `burn(address _oapp, uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash)`
- `clear(address _oapp, (uint32 srcEid, bytes32 sender, uint64 nonce) _origin, bytes32 _guid, bytes _message)`
- `composeQueue(address from, address to, bytes32 guid, uint16 index) view returns (bytes32 messageHash)`
- `defaultReceiveLibrary(uint32 srcEid) view returns (address lib)`
- `defaultReceiveLibraryTimeout(uint32 srcEid) view returns (address lib, uint256 expiry)`
- `defaultSendLibrary(uint32 dstEid) view returns (address lib)`
- `delegates(address oapp) view returns (address delegate)`
- `eid() view returns (uint32)`
- `EMPTY_PAYLOAD_HASH() view returns (bytes32)`
- `getConfig(address _oapp, address _lib, uint32 _eid, uint32 _configType) view returns (bytes config)`
- `getReceiveLibrary(address _receiver, uint32 _srcEid) view returns (address lib, bool isDefault)`
- `getRegisteredLibraries() view returns (address[])`
- `getSendContext() view returns (uint32, address)`
- `getSendLibrary(address _sender, uint32 _dstEid) view returns (address lib)`
- `inboundNonce(address _receiver, uint32 _srcEid, bytes32 _sender) view returns (uint64)`
- `inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 inboundNonce) view returns (bytes32 payloadHash)`
- `initializable((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver) view returns (bool)`
- `isDefaultSendLibrary(address _sender, uint32 _dstEid) view returns (bool)`
- `isRegisteredLibrary(address lib) view returns (bool)`
- `isSendingMessage() view returns (bool)`
- `isSupportedEid(uint32 _eid) view returns (bool)`
- `isValidReceiveLibrary(address _receiver, uint32 _srcEid, address _actualReceiveLib) view returns (bool)`
- `lazyInboundNonce(address receiver, uint32 srcEid, bytes32 sender) view returns (uint64 nonce)`
- `lzCompose(address _from, address _to, bytes32 _guid, uint16 _index, bytes _message, bytes _extraData) payable`
- `lzComposeAlert(address _from, address _to, bytes32 _guid, uint16 _index, uint256 _gas, uint256 _value, bytes _message, bytes _extraData, bytes _reason)`
- `lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver, bytes32 _guid, bytes _message, bytes _extraData) payable`
- `lzReceiveAlert((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver, bytes32 _guid, uint256 _gas, uint256 _value, bytes _message, bytes _extraData, bytes _reason)`
- `lzToken() view returns (address)`
- `nativeToken() view returns (address)`
- `nextGuid(address _sender, uint32 _dstEid, bytes32 _receiver) view returns (bytes32)`
- `NIL_PAYLOAD_HASH() view returns (bytes32)`
- `nilify(address _oapp, uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash)`
- `outboundNonce(address sender, uint32 dstEid, bytes32 receiver) view returns (uint64 nonce)`
- `owner() view returns (address)`
- `quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
- `receiveLibraryTimeout(address receiver, uint32 srcEid) view returns (address lib, uint256 expiry)`
- `recoverToken(address _token, address _to, uint256 _amount)`
- `registerLibrary(address _lib)`
- `renounceOwnership()`
- `send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) receipt)`
- `sendCompose(address _to, bytes32 _guid, uint16 _index, bytes _message)`
- `setConfig(address _oapp, address _lib, (uint32 eid, uint32 configType, bytes config)[] _params)`
- `setDefaultReceiveLibrary(uint32 _eid, address _newLib, uint256 _gracePeriod)`
- `setDefaultReceiveLibraryTimeout(uint32 _eid, address _lib, uint256 _expiry)`
- `setDefaultSendLibrary(uint32 _eid, address _newLib)`
- `setDelegate(address _delegate)`
- `setLzToken(address _lzToken)`
- `setReceiveLibrary(address _oapp, uint32 _eid, address _newLib, uint256 _gracePeriod)`
- `setReceiveLibraryTimeout(address _oapp, uint32 _eid, address _lib, uint256 _expiry)`
- `setSendLibrary(address _oapp, uint32 _eid, address _newLib)`
- `skip(address _oapp, uint32 _srcEid, bytes32 _sender, uint64 _nonce)`
- `transferOwnership(address newOwner)`
- `verifiable((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver) view returns (bool)`
- `verify((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver, bytes32 _payloadHash)`
