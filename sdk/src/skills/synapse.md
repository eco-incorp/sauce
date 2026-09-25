# Synapse Protocol

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

## Category

bridge | Direction: any-to-any (L1-to-L2, L2-to-L2, L2-to-L1) | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), Avalanche (43114)

## SauceScript Functions

### bridge

Deposit tokens for cross-chain transfer via SynapseBridge.

```typescript
import { SynapseBridgeABI as ISynapseBridge } from "./abis";

function main(
  bridgeAddress: Address,
  recipient: Address,
  chainId: Uint256,
  token: Address,
  amount: Uint256,
): Uint256 {
  const bridge = ISynapseBridge.at(bridgeAddress);
  bridge.deposit(recipient, chainId, token, amount);
  return 1;
}
```

- `chainId`: Destination EVM chain ID
- `token`: ERC-20 token to bridge
- Requires ERC-20 approval to the SynapseBridge

## Deployed Addresses

| Chain     | Contract      | Address                                      |
| --------- | ------------- | -------------------------------------------- |
| Ethereum  | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` |
| Ethereum  | cctpRouter    | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` |
| Arbitrum  | synapseBridge | `0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9` |
| Optimism  | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` |
| Base      | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` |
| Polygon   | synapseBridge | `0x8F5BBB2585b4009Ee16a8b589fE81B1A204aD9d7` |
| Avalanche | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` |

## ABI Reference

### SynapseBridgeABI

- `deposit(address to, uint256 chainId, address token, uint256 amount)` - Deposit tokens for bridging to destination chain
- `depositAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)` - Deposit with swap on destination (e.g. nUSD to USDC). Use token indices from the destination AMM pool
- `redeem(address to, uint256 chainId, address token, uint256 amount)` - Redeem bridge tokens (for wrapped/synthetic assets like nUSD, nETH)

## Notes

- `deposit`: For canonical tokens supported directly by the bridge
- `depositAndSwap`: For bridging with an automatic swap on destination (e.g. bridge nUSD, swap to USDC on arrival)
- `redeem`: For synthetic bridge tokens (nUSD, nETH) -- burns on source, mints on destination
- Also supports CCTP-based USDC bridging via separate cctpRouter contract
- Finality: typically 5-15 minutes depending on route
- Requires ERC-20 approval to the SynapseBridge
- TVL: $100M+. Audited
