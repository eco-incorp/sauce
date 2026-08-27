# deBridge

Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.

## Category
bridge + cross-chain trading | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), BSC (56), Avalanche (43114)

## SauceScript Functions

### bridge
Create a cross-chain order via DLN (DeBridge Liquidity Network).
```typescript
import { DlnSourceABI as IDlnSource } from "./abis";

function main(dlnSourceAddress: Address, giveToken: Address, giveAmount: Uint256, takeToken: Bytes, takeAmount: Uint256, takeChainId: Uint256, receiver: Bytes): Uint256 {
  const dln = IDlnSource.at(dlnSourceAddress);
  return dln.createOrder({giveTokenAddress: giveToken, giveAmount: giveAmount, takeTokenAddress: takeToken, takeAmount: takeAmount, takeChainId: takeChainId, receiverDst: receiver, givePatchAuthoritySrc: ctx.msgSender(), orderAuthorityAddressDst: receiver, allowedTakerDst: 0x00, externalCall: 0x00, allowedCancelBeneficiarySrc: 0x00}, 0x00, 0, 0x00);
}
```
- `giveToken`: ERC-20 token address to send on source chain
- `giveAmount`: Amount of source token to send
- `takeToken`: Token address on destination chain (as bytes, since it may be on a non-EVM chain)
- `takeAmount`: Minimum amount to receive on destination. Set slightly below `giveAmount` to account for market maker spread
- `takeChainId`: Destination chain ID (uses EVM chain IDs)
- `receiver`: Recipient address on destination chain (as bytes)
- `givePatchAuthoritySrc`: Address allowed to increase give amount (set to `msg.sender`)
- `orderAuthorityAddressDst`: Address that can cancel/modify order on destination (set to `receiver`)
- `allowedTakerDst`: Restrict which market maker can fill (empty `0x00` = any taker)
- `externalCall`: Optional calldata to execute on destination after fill
- `allowedCancelBeneficiarySrc`: Restrict who receives refund on cancellation (empty `0x00` = order creator)
- Requires ERC-20 approval to DlnSource

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Ethereum | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| Arbitrum | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Arbitrum | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| Optimism | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Optimism | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| Base | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Base | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| Polygon | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Polygon | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| BSC | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| BSC | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |
| Avalanche | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` |
| Avalanche | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` |

## ABI Reference

### DlnSourceABI
- `createOrder(OrderCreation _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope) returns (uint256 orderId)` [payable] - Create a cross-chain limit order. Market makers compete to fill on destination

OrderCreation tuple: `(address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc)`

### DlnDestinationABI
- `fulfillOrder(Order _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority)` [payable] - Fill an order on the destination chain (called by market makers/solvers)

Order tuple: `(uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes receiverDst, address takeTokenAddress, uint256 takeAmount, bytes givePatchAuthoritySrc, address orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall)`

## Notes
- Intent/order-based architecture: users create orders specifying desired outcome, market makers compete to fill
- Uses EVM chain IDs for destination (unlike LayerZero/Wormhole which use their own IDs)
- Same DlnSource and DlnDestination addresses deployed across all supported chains
- `takeAmount` should be set slightly below market rate to incentivize market makers
- Supports cross-chain swaps natively (giveToken and takeToken can be different assets)
- `externalCall` enables arbitrary contract execution on destination after the fill
- Finality: typically 1-5 minutes (market maker fills immediately, then settles asynchronously)
- Requires ERC-20 approval to DlnSource for the give token
- TVL: $200M+. Audited
