<!-- Generated from the SDK's registries. Do not edit. -->

# Connext (Everclear) (`connext`)

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, base, arbitrum |
| Document | [connext.md](../connext.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's everclearSpoke):

```sauce chain=ethereum
import EverclearSpokeABI from "./protocols/connext/EverclearSpokeABI.json";

const EVERCLEAR_SPOKE = 0xa05A3380889115bf313f1Db9d5f335157Be4D816n;

function main() {
  const bound = EverclearSpokeABI.at(EVERCLEAR_SPOKE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `EverclearSpokeABI.at(0xa05A3380889115bf313f1Db9d5f335157Be4D816n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `EverclearSpokeABI.at(0xa05A3380889115bf313f1Db9d5f335157Be4D816n)` |
| [Base](../../../sauce-chains/references/base.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `EverclearSpokeABI.at(0xa05A3380889115bf313f1Db9d5f335157Be4D816n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `EverclearSpokeABI.at(0xa05A3380889115bf313f1Db9d5f335157Be4D816n)` |

## ABI

### `EverclearSpokeABI`

`import EverclearSpokeABI from "./protocols/connext/EverclearSpokeABI.json";` Speaks for: everclearSpoke.

- `newIntent(uint32[] destinations, address receiver, address inputAsset, address outputAsset, uint256 amount, uint256 amountOutMin, uint48 ttl, bytes data) returns (bytes32 intentId, (bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) intent)`
