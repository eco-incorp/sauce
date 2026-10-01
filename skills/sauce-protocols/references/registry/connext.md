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
  require(Connext.EverclearSpoke != 0n);
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

- `newIntent(uint32[] destinations, address receiver, address inputAsset, address outputAsset, uint256 amount, uint256 amountOutMin, uint48 ttl, bytes data) returns (bytes32 intentId, (bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) intent)`
