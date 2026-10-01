# Vertex

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for sub-second order matching on Arbitrum.

## Category

perpetuals | Chains and addresses: [registry/vertex.md](registry/vertex.md)

## Key Operations

- **depositCollateral**: Deposit collateral into Vertex endpoint

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit collateral
import { EndpointABI as IEndpoint } from "./abis";
function main(endpointAddress: Address, productId: Uint256, amount: Uint256): Uint256 {
  const endpoint = IEndpoint.at(endpointAddress);
  endpoint.depositCollateral(0x000000000000000000000000, productId, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/vertex.md](registry/vertex.md).

## Notes

- TVL: $100M+. Off-chain sequencer for sub-second order matching
- Uses subaccount system (bytes12 identifier) for position isolation
- productId identifies the market (spot or perp)
- Most trading happens off-chain via sequencer - on-chain methods are for deposits/withdrawals
- Approve collateral token to endpoint before depositing
