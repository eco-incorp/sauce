# Across

Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.

## Category

bridge | Direction: L2-to-L2, L1-to-L2, L2-to-L1 | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), zkSync (324), Linea (59144), Mode (34443), Blast (81457), Scroll (534352)

## SauceScript Functions

### bridge

Deposit tokens into SpokePool for cross-chain transfer. Uses the legacy `deposit` function.

```typescript
import { AcrossSpokePoolABI as ISpokePool } from "./abis";

function main(
  spokePoolAddress: Address,
  token: Address,
  amount: Uint256,
  destinationChainId: Uint256,
  recipient: Address,
): Uint256 {
  const spokePool = ISpokePool.at(spokePoolAddress);
  spokePool.deposit(recipient, token, amount, destinationChainId, 0, 0, ctx.msgSender(), 0);
  return 1;
}
```

- `token`: ERC-20 token to bridge (must be supported by Across)
- `destinationChainId`: EVM chain ID of destination chain
- `recipient`: Address to receive tokens on destination chain
- Requires ERC-20 approval to the SpokePool
- Note: `depositV3` is the current recommended method (see ABI below)

## Deployed Addresses

| Chain    | Contract  | Address                                      |
| -------- | --------- | -------------------------------------------- |
| Ethereum | hubPool   | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` |
| Ethereum | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` |
| Arbitrum | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` |
| Optimism | spokePool | `0x6f26Bf09B1C792e3228e5467807a900A503c0281` |
| Base     | spokePool | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` |
| Polygon  | spokePool | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` |
| zkSync   | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` |
| Linea    | spokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` |
| Mode     | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` |
| Blast    | spokePool | `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1` |
| Scroll   | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` |

## ABI Reference

### AcrossSpokePoolABI

- `depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message)` [payable] - Current recommended deposit method. Supports cross-chain swaps (inputToken != outputToken), exclusive relayer, and arbitrary message passing
- `deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes message, uint256 maxCount)` [payable] - Legacy deposit method (deprecated, use depositV3)

### AcrossHubPoolABI

- `liquidityUtilizationCurrent(address l1Token) returns (uint256)` - Get current utilization rate (view)
- `pooledTokens(address l1Token) returns (address lpToken, bool isEnabled, uint32 lastLpFeeUpdate, int256 utilizedReserves, uint256 liquidReserves, uint256 undistributedLpFees)` - Get pool token info (view)

## Notes

- Fast fills: relayers fill deposits on destination within minutes, then claim reimbursement via optimistic oracle
- Finality: deposit confirmation on source chain, fill within 1-10 minutes typically
- `depositV3` is recommended over legacy `deposit` -- supports output token specification and exclusive relayers
- Requires ERC-20 approval to the SpokePool address on source chain
- HubPool on Ethereum only -- SpokePools on all supported L2s
- TVL: $500M+. Audited
