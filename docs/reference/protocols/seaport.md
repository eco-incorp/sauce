<!-- Generated from the SDK's registries. Do not edit. -->

# Seaport (`seaport`)

OpenSea's decentralized NFT marketplace protocol supporting flexible order types including English and Dutch auctions, collection offers, and trait-based offers.

| Fact | Value |
| --- | --- |
| Category | NFT marketplaces |
| Family | none |
| Namespace | `Seaport` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |

## Key Operations

- **fulfillBasicOrder**: Fulfill a basic NFT buy/sell order
- **cancel**: Cancel pending orders

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Note: Seaport orders require off-chain signature creation via seaport-js SDK.
// On-chain fulfillment uses the signed order parameters.
```

## Notes

- Same address across all 5 chains
- Zone-based access control for order restrictions
- Conduits are approved transfer proxies - conduitKey=bytes32(0) for default
- basicOrderType encodes: ERC-721/1155 + ETH/ERC-20 payment + buy/sell direction
- Orders are signed off-chain, fulfilled on-chain - use seaport-js SDK for order creation

## Its names in a program

On Ethereum, `Seaport` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's seaportV16, `0x0000000000000068F116a894984e2DB1123eB395`.
  require(Seaport.SeaportV16 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Optimism](../chains/optimism.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Polygon](../chains/polygon.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Arc](../chains/arc.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Base](../chains/base.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Arbitrum One](../chains/arbitrum.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |

## ABI

### `SeaportABI`

`import SeaportABI from "./protocols/seaport/SeaportABI.json";` Speaks for: seaportV16.

- `fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool fulfilled)`
- `cancel((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 counter)[] orders) returns (bool cancelled)`
