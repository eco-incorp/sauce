<!-- Generated from the SDK's registries. Do not edit. -->

# Wormhole (`wormhole`)

Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |
| Document | [wormhole.md](../wormhole.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's coreBridge):

```sauce chain=ethereum
import WormholeCoreBridgeABI from "./protocols/wormhole/WormholeCoreBridgeABI.json";

const CORE_BRIDGE = 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288Bn;

function main() {
  const bound = WormholeCoreBridgeABI.at(CORE_BRIDGE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` | `WormholeCoreBridgeABI.at(0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288Bn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` | `WormholeTokenBridgeABI.at(0x3ee18B2214AFF97000D974cf647E7C347E8fa585n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | coreBridge | `0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722` | `WormholeCoreBridgeABI.at(0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | tokenBridge | `0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b` | `WormholeTokenBridgeABI.at(0x1D68124e65faFC907325e3EDbF8c4d84499DAa8bn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | coreBridge | `0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7` | `WormholeCoreBridgeABI.at(0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | tokenBridge | `0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE` | `WormholeTokenBridgeABI.at(0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdEn)` |
| [Arc](../../../sauce-chains/references/arc.md) | coreBridge | `0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027` | `WormholeCoreBridgeABI.at(0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027n)` |
| [Base](../../../sauce-chains/references/base.md) | coreBridge | `0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6` | `WormholeCoreBridgeABI.at(0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6n)` |
| [Base](../../../sauce-chains/references/base.md) | tokenBridge | `0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627` | `WormholeTokenBridgeABI.at(0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` | `WormholeCoreBridgeABI.at(0xa5f208e072434bC67592E4C49C1B991BA79BCA46n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` | `WormholeTokenBridgeABI.at(0x0b2402144Bb366A632D14B83F244D2e0e21bD39cn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | coreBridge | `0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c` | `WormholeCoreBridgeABI.at(0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26cn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | tokenBridge | `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052` | `WormholeTokenBridgeABI.at(0x0e082F06FF657D94310cB8cE8B0D9a04541d8052n)` |

## ABI

### `WormholeCoreBridgeABI`

`import WormholeCoreBridgeABI from "./protocols/wormhole/WormholeCoreBridgeABI.json";` Speaks for: coreBridge.

- `publishMessage(uint32 nonce, bytes payload, uint8 consistencyLevel) payable returns (uint64 sequence)`
- `messageFee() view returns (uint256)`

### `WormholeTokenBridgeABI`

`import WormholeTokenBridgeABI from "./protocols/wormhole/WormholeTokenBridgeABI.json";` Speaks for: tokenBridge.

- `transferTokens(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint256 arbiterFee, uint32 nonce) payable returns (uint64 sequence)`
- `completeTransfer(bytes encodedVm)`
- `wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) view returns (address)`
