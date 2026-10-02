<!-- Generated from the SDK's registries. Do not edit. -->

# Vertex (`vertex`)

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for sub-second order matching on Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `Vertex` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **depositCollateral**: Deposit collateral into Vertex endpoint

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit collateral
import { EndpointABI as IEndpoint } from "./abis";
function main(endpointAddress: Address, productId: Uint256, amount: Uint256): Uint256 {
  const endpoint = IEndpoint.at(endpointAddress);
  endpoint.depositCollateral(0x000000000000000000000000, productId, amount);
  return 1;
}
```

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
  // Arbitrum One's clearinghouse, `0x773bb71b0108b060b76746422ee810bfec9a963d`.
  require(Vertex.Clearinghouse != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | clearinghouse | `0x773bb71b0108b060b76746422ee810bfec9a963d` | `Vertex.Clearinghouse` |
| [Arbitrum One](../chains/arbitrum.md) | endpoint | `0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965` | `Vertex.Endpoint` |

## ABI

### `ClearinghouseABI`

`import ClearinghouseABI from "./protocols/vertex/ClearinghouseABI.json";` Speaks for: clearinghouse.

- `withdrawCollateral((bytes32 sender, uint32 productId, uint128 amount, uint64 nonce) txn)`

### `EndpointABI`

`import EndpointABI from "./protocols/vertex/EndpointABI.json";` Speaks for: endpoint.

- `depositCollateral(bytes12 subaccountName, uint32 productId, uint128 amount)`
- `submitSlowModeTransaction(bytes transaction)`
