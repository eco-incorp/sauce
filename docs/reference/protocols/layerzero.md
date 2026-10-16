<!-- Generated from the SDK's registries. Do not edit. -->

# LayerZero (`layerzero`)

> LayerZero is a messenger between chains: it carries messages and tokens from one to another. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Layerzero` on ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Chains | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### sendMessage

Send a cross-chain message via LayerZero Endpoint V2.

```typescript
import { LayerZeroEndpointV2ABI as IEndpointV2 } from "./abis";

function main(
  endpointAddress: Address,
  dstEid: Uint256,
  receiver: Uint256,
  message: bytes,
): { guid: Uint256; nonce: Uint256; fee: { nativeFee: Uint256; lzTokenFee: Uint256 } } {
  const endpoint = IEndpointV2.at(endpointAddress);
  return endpoint.send(
    { dstEid: dstEid, receiver: receiver, message: message, options: 0x00, payInLzToken: false },
    ctx.msgSender(),
  );
}
```

- `dstEid`: LayerZero endpoint ID for destination chain (NOT the EVM chain ID)
- `receiver`: Destination contract address as bytes32 (left-padded)
- `message`: Arbitrary message payload
- `options`: Execution options (gas limits, etc.). Use `0x00` for defaults
- `payInLzToken`: false = pay fees in native token, true = pay in ZRO token
- Requires native token (ETH) for messaging fees (sent as msg.value)

## Notes

- This is a messaging protocol, not a direct token bridge. Token bridging is done via OFT (Omnichain Fungible Token) contracts built on top of LayerZero
- Uses endpoint IDs (dstEid) for chain identification, NOT EVM chain IDs
- Same endpoint address across most chains (except zkSync)
- Use `quote` to estimate fees before sending
- Finality: depends on DVN (Decentralized Verifier Network) configuration, typically 1-5 minutes
- Powers Stargate V2, OFT tokens, and many cross-chain dApps
- TVL: $5B+ (across protocols built on LayerZero). Audited
- On Arc (5042, eid 30417) the messaging fee `msg.value` is native USDC at 18 decimals, from the same balance as the USDC ERC-20 `0x3600…0000`

## Its names in a program

On Ethereum, `Layerzero` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's endpointV2, `0x1a44076050125825900e736c501f859c50fE728c`.
  require(Layerzero.EndpointV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Optimism](../chains/optimism.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [BNB Chain](../chains/bsc.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Polygon](../chains/polygon.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [zkSync Era](../chains/zksync.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `Layerzero.EndpointV2` |
| [Arc](../chains/arc.md) | endpointV2 | `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | `Layerzero.EndpointV2` |
| [Base](../chains/base.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Arbitrum One](../chains/arbitrum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Avalanche C-Chain](../chains/avalanche.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Linea](../chains/linea.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Scroll](../chains/scroll.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |

## ABI

### `LayerZeroEndpointV2ABI`

`import LayerZeroEndpointV2ABI from "./protocols/layerzero/LayerZeroEndpointV2ABI.json";` Speaks for: endpointV2.

- `send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) receipt)`
- `quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
