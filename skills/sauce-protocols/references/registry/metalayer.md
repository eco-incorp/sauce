<!-- Generated from the SDK's registries. Do not edit. -->

# Metalayer (`metalayer`)

Caldera's interchain messaging, built on Hyperlane: a router on each chain dispatches a message through its own Hyperlane mailbox to the router on the destination, which calls the recipient's handle with the message and the results of any cross-chain reads it asked for.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Metalayer` on ethereum, bsc, base, arbitrum |
| Chains | ethereum, bsc, base, arbitrum |
| Document | [metalayer.md](../metalayer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Metalayer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's router, `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3`.
  require(Metalayer.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |

## ABI

### `MetalayerRouterABI`

`import MetalayerRouterABI from "./protocols/metalayer/MetalayerRouterABI.json";` Speaks for: router.

- `dispatch(uint32 _destinationDomain, bytes32 _recipientAddress, (uint32 domain, address target, bytes callData)[] _reads, bytes _writeCallData, uint8 _finalityState, uint256 _gasLimit) payable`
- `quoteDispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes messageBody, bytes defaultHookMetadata) view returns (uint256 fee)`
