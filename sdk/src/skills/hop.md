# Hop Protocol

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

## Category
bridge | Direction: L1-to-L2 (sendToL2), L2-to-L2/L1 (swapAndSend) | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Polygon (137), Base (8453)

## SauceScript Functions

### bridgeFromL1
Send tokens from Ethereum L1 to an L2 via the Hop L1Bridge.
```typescript
import { HopL1BridgeABI as IL1Bridge } from "./abis";

function main(bridgeAddress: Address, chainId: Uint256, recipient: Address, amount: Uint256, amountOutMin: Uint256): Uint256 {
  const bridge = IL1Bridge.at(bridgeAddress);
  bridge.sendToL2(chainId, recipient, amount, amountOutMin, 99999999999, 0x0000000000000000000000000000000000000000, 0);
  return 1;
}
```
- `bridgeAddress`: Token-specific L1Bridge (e.g. l1EthBridge for ETH, l1UsdcBridge for USDC)
- `chainId`: EVM chain ID of destination L2
- `amountOutMin`: Minimum tokens to receive after AMM swap on L2 (slippage protection)
- `deadline`: Set to far future (99999999999) to avoid expiry
- `relayer`/`relayerFee`: Set to zero for standard transfers
- Requires ERC-20 approval to the L1Bridge for ERC-20 tokens, or send ETH as msg.value

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | l1EthBridge | `0xb8901acb165ed027e32754e0ffe830802919727f` |
| Ethereum | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` |
| Arbitrum | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e36F8Cda811Da1d199967c8` |
| Optimism | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` |
| Polygon | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` |
| Base | l2AmmWrapper | `0x46ae9BaB8CEA96610807a275EBD36f8e916b5571` |

## ABI Reference

### HopL1BridgeABI
- `sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline, address relayer, uint256 relayerFee)` [payable] - Bridge tokens from L1 to L2

### HopL2AmmWrapperABI
- `swapAndSend(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 destinationAmountOutMin, uint256 destinationDeadline)` [payable] - Bridge tokens from L2 to another L2 or back to L1. Swaps canonical token to hToken, sends via bonder

## Notes
- L1-to-L2: Uses `sendToL2` on token-specific L1Bridge contracts
- L2-to-L2 or L2-to-L1: Uses `swapAndSend` on L2AmmWrapper (swaps canonical token to hToken for bridging)
- Each supported token has separate bridge contracts on L1 and AMM wrappers on L2
- Bonders provide fast liquidity on destination (minutes), settle via canonical bridge later
- `bonderFee` on L2 must be obtained from Hop API or SDK
- Finality: minutes with bonder, 7+ days without bonder (canonical path)
- TVL: $50M+. Audited
