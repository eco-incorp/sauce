<!-- Generated from the SDK's registries. Do not edit. -->

# Vertex (`vertex`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Vertex is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for sub-second order matching on Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `Vertex` on arbitrum |
| Chains | arbitrum |

## What it offers

- **depositCollateral**: Deposit collateral into Vertex endpoint

## Notes

- TVL: $100M+. Off-chain sequencer for sub-second order matching
- Uses subaccount system (bytes12 identifier) for position isolation
- productId identifies the market (spot or perp)
- Most trading happens off-chain via sequencer - on-chain methods are for deposits/withdrawals
- Approve collateral token to endpoint before depositing

## Its names in a program

On Arbitrum One, `Vertex` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's clearinghouse, `0x773BB71B0108b060b76746422eE810Bfec9A963d`.
  require(Vertex.Clearinghouse != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | clearinghouse | `0x773BB71B0108b060b76746422eE810Bfec9A963d` | `Vertex.Clearinghouse` |
| [Arbitrum One](../chains/arbitrum.md) | endpoint | `0x73EAB16c88B9f38d3f2661C9e5875Ec0eEEE2965` | `Vertex.Endpoint` |

## ABI

### `ClearinghouseABI`

`import ClearinghouseABI from "./protocols/vertex/ClearinghouseABI.json";` Speaks for: clearinghouse.

- `withdrawCollateral((bytes32 sender, uint32 productId, uint128 amount, uint64 nonce) txn)`

### `EndpointABI`

`import EndpointABI from "./protocols/vertex/EndpointABI.json";` Speaks for: endpoint.

- `depositCollateral(bytes12 subaccountName, uint32 productId, uint128 amount)`
- `submitSlowModeTransaction(bytes transaction)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
