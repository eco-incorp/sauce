<!-- Generated from the SDK's registries. Do not edit. -->

# Vertex (`vertex`)

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for fast order matching on Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [vertex.md](../vertex.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's clearinghouse):

```sauce chain=arbitrum
import ClearinghouseABI from "./protocols/vertex/ClearinghouseABI.json";

const CLEARINGHOUSE = 0x773bb71b0108b060b76746422ee810bfec9a963dn;

function main() {
  const bound = ClearinghouseABI.at(CLEARINGHOUSE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | clearinghouse | `0x773bb71b0108b060b76746422ee810bfec9a963d` | `ClearinghouseABI.at(0x773bb71b0108b060b76746422ee810bfec9a963dn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | endpoint | `0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965` | `EndpointABI.at(0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965n)` |

## ABI

### `ClearinghouseABI`

`import ClearinghouseABI from "./protocols/vertex/ClearinghouseABI.json";` Speaks for: clearinghouse.

- `withdrawCollateral((bytes32 sender, uint32 productId, uint128 amount, uint64 nonce) txn)`

### `EndpointABI`

`import EndpointABI from "./protocols/vertex/EndpointABI.json";` Speaks for: endpoint.

- `depositCollateral(bytes12 subaccountName, uint32 productId, uint128 amount)`
- `submitSlowModeTransaction(bytes transaction)`
