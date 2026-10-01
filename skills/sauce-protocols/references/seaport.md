# Seaport

OpenSea's decentralized NFT marketplace protocol supporting flexible order types including English and Dutch auctions, collection offers, and trait-based offers.

## Category

nft-marketplace | Chains and addresses: [registry/seaport.md](registry/seaport.md)

## Key Operations

- **fulfillBasicOrder**: Fulfill a basic NFT buy/sell order
- **cancel**: Cancel pending orders

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Note: Seaport orders require off-chain signature creation via seaport-js SDK.
// On-chain fulfillment uses the signed order parameters.
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/seaport.md](registry/seaport.md).

## Notes

- Same address across all 5 chains
- Zone-based access control for order restrictions
- Conduits are approved transfer proxies - conduitKey=bytes32(0) for default
- basicOrderType encodes: ERC-721/1155 + ETH/ERC-20 payment + buy/sell direction
- Orders are signed off-chain, fulfilled on-chain - use seaport-js SDK for order creation
