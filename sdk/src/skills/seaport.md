# Seaport

OpenSea's decentralized NFT marketplace protocol supporting flexible order types including English and Dutch auctions, collection offers, and trait-based offers.

## Category

nft-marketplace | Chains: Ethereum, Arbitrum, Optimism, Polygon, Base, Arc

## Key Operations

- **fulfillBasicOrder**: Fulfill a basic NFT buy/sell order
- **cancel**: Cancel pending orders

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/seaport";
```

## SauceScript Examples

```typescript
// Note: Seaport orders require off-chain signature creation via seaport-js SDK.
// On-chain fulfillment uses the signed order parameters.
```

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` |
| Arbitrum | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` |
| Optimism | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` |
| Polygon  | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` |
| Base     | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` |

## ABI Methods

### SeaportABI

- `fulfillBasicOrder(tuple)` - Fulfill a basic order. Payable. Returns fulfilled bool. BasicOrderParameters tuple:
  - `considerationToken` (address) - Token to pay (address(0) for ETH)
  - `considerationIdentifier` (uint256) - Token ID (0 for ERC-20/ETH)
  - `considerationAmount` (uint256) - Payment amount
  - `offerer` (address) - Order creator
  - `zone` (address) - Zone contract for access control
  - `offerToken` (address) - NFT contract address
  - `offerIdentifier` (uint256) - NFT token ID
  - `offerAmount` (uint256) - NFT amount (1 for ERC-721)
  - `basicOrderType` (uint8) - Order type enum
  - `startTime`, `endTime` (uint256) - Order validity window
  - `zoneHash` (bytes32), `salt` (uint256) - Order uniqueness
  - `offererConduitKey`, `fulfillerConduitKey` (bytes32) - Conduit keys for token transfers
  - `totalOriginalAdditionalRecipients` (uint256) - Creator fees count
  - `additionalRecipients` (`(uint256 amount, address recipient)[]`) - Extra consideration recipients (fees)
  - `signature` (bytes) - Offerer's EIP-712 signature
- `cancel(tuple[])` - Cancel orders. Params: orders (array of OrderComponents: offerer, zone, offer items, consideration items, orderType, startTime, endTime, zoneHash, salt, conduitKey, counter). Returns cancelled bool

## Notes

- Same address across all 5 chains
- Zone-based access control for order restrictions
- Conduits are approved transfer proxies - conduitKey=bytes32(0) for default
- basicOrderType encodes: ERC-721/1155 + ETH/ERC-20 payment + buy/sell direction
- Orders are signed off-chain, fulfilled on-chain - use seaport-js SDK for order creation
