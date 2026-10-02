<!-- Generated from the SDK's registries. Do not edit. -->

# Seaport (`seaport`)

OpenSea's decentralized NFT marketplace protocol supporting flexible order types including English and Dutch auctions, collection offers, and trait-based offers.

| Fact | Value |
| --- | --- |
| Category | NFT marketplaces |
| Family | none |
| Namespace | `Seaport` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |
| Document | [seaport.md](../seaport.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Seaport` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's seaportV16, `0x0000000000000068F116a894984e2DB1123eB395`.
  require(Seaport.SeaportV16 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Optimism](../../../sauce-chains/references/optimism.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Polygon](../../../sauce-chains/references/polygon.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Arc](../../../sauce-chains/references/arc.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Base](../../../sauce-chains/references/base.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |

## ABI

### `SeaportABI`

`import SeaportABI from "./protocols/seaport/SeaportABI.json";` Speaks for: seaportV16.

- `fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool fulfilled)`
- `cancel((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 counter)[] orders) returns (bool cancelled)`
