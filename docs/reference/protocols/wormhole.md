<!-- Generated from the SDK's registries. Do not edit. -->

# Wormhole (`wormhole`)

> Wormhole is a messenger between chains: it carries messages and tokens from one to another. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Wormhole` on ethereum, optimism, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### bridgeTokens

Transfer tokens cross-chain via the Wormhole TokenBridge.

```typescript
import { WormholeTokenBridgeABI as ITokenBridge } from "./abis";

function main(
  tokenBridgeAddress: Address,
  token: Address,
  amount: Uint256,
  recipientChain: Uint256,
  recipient: Uint256,
): Uint256 {
  const bridge = ITokenBridge.at(tokenBridgeAddress);
  return bridge.transferTokens(token, amount, recipientChain, recipient, 0, 0);
}
```

- `token`: ERC-20 token to bridge
- `recipientChain`: Wormhole chain ID (NOT EVM chain ID). E.g. Ethereum=2, Arbitrum=23, Base=30
- `recipient`: Destination address as bytes32 (left-padded)
- `arbiterFee`: Fee for relayer (set to 0 for self-redemption)
- `nonce`: Unique identifier (set to 0)
- Requires ERC-20 approval to the TokenBridge
- Requires native token for Wormhole message fee (sent as msg.value, use `coreBridge.messageFee()` to query)

## Notes

- Uses Wormhole chain IDs (NOT EVM chain IDs). E.g. Ethereum=2, BSC=4, Polygon=5, Avalanche=6, Arbitrum=23, Optimism=24, Base=30
- Two-step process: (1) `transferTokens` on source, (2) `completeTransfer` on destination with signed VAA
- If `arbiterFee` > 0, any relayer can submit the VAA and earn the fee. Otherwise, recipient must self-redeem
- Bridged tokens are wrapped versions (e.g. "Wormhole-wrapped USDC") unless using CCTP integration
- 19 guardians must reach 2/3+1 consensus for message finality (typically 1-15 minutes)
- Query `messageFee()` on CoreBridge to know how much native token to attach
- TVL: $3B+. Audited

## Its names in a program

On Ethereum, `Wormhole` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's coreBridge, `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B`.
  require(Wormhole.CoreBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` | `Wormhole.CoreBridge` |
| [Ethereum](../chains/ethereum.md) | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` | `Wormhole.TokenBridge` |
| [Optimism](../chains/optimism.md) | coreBridge | `0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722` | `Wormhole.CoreBridge` |
| [Optimism](../chains/optimism.md) | tokenBridge | `0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b` | `Wormhole.TokenBridge` |
| [Polygon](../chains/polygon.md) | coreBridge | `0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7` | `Wormhole.CoreBridge` |
| [Polygon](../chains/polygon.md) | tokenBridge | `0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE` | `Wormhole.TokenBridge` |
| [Arc](../chains/arc.md) | coreBridge | `0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027` | `Wormhole.CoreBridge` |
| [Base](../chains/base.md) | coreBridge | `0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6` | `Wormhole.CoreBridge` |
| [Base](../chains/base.md) | tokenBridge | `0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627` | `Wormhole.TokenBridge` |
| [Arbitrum One](../chains/arbitrum.md) | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` | `Wormhole.CoreBridge` |
| [Arbitrum One](../chains/arbitrum.md) | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` | `Wormhole.TokenBridge` |
| [Avalanche C-Chain](../chains/avalanche.md) | coreBridge | `0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c` | `Wormhole.CoreBridge` |
| [Avalanche C-Chain](../chains/avalanche.md) | tokenBridge | `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052` | `Wormhole.TokenBridge` |

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
