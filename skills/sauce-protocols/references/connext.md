# Connext (Everclear)

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

## Category

bridge | Direction: any-to-any (L2-to-L2, L1-to-L2, L2-to-L1) | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453)

## SauceScript Functions

### bridge

Create a new cross-chain intent via EverclearSpoke.

```typescript
import { EverclearSpokeABI as IEverclearSpoke } from "./abis";

function main(
  spokeAddress: Address,
  destinations: Uint256[],
  recipient: Address,
  inputAsset: Address,
  outputAsset: Address,
  amount: Uint256,
  amountOutMin: Uint256,
): Uint256 {
  const spoke = IEverclearSpoke.at(spokeAddress);
  const created = spoke.newIntent(
    destinations,
    recipient,
    inputAsset,
    outputAsset,
    amount,
    amountOutMin,
    86400,
    "",
  );
  return created.intentId;
}
```

- `destinations`: Array of destination domain IDs (uint32[]) -- can specify multiple possible destinations
- `recipient`: Address to receive tokens on destination
- `inputAsset`: Token to send on source chain
- `outputAsset`: Token to receive on destination chain (can differ from input for cross-chain swaps)
- `amountOutMin`: Minimum amount the recipient must receive
- `ttl`: Time-to-live in seconds (86400 = 24 hours). Intent expires if unfilled
- Requires ERC-20 approval to the EverclearSpoke

## Deployed Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Ethereum | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` |
| Arbitrum | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` |
| Optimism | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` |
| Base     | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` |

## ABI Reference

### EverclearSpokeABI

- `newIntent(uint32[] destinations, address receiver, address inputAsset, address outputAsset, uint256 amount, uint256 amountOutMin, uint48 ttl, bytes data) returns (bytes32 intentId, Intent intent)` - Create a cross-chain transfer intent. Solvers compete to fill the intent on the destination chain. A `bytes32`-typed overload takes non-EVM receivers and assets

## Notes

- Intent-based architecture: users express desired outcome, solvers compete to fill
- Rebranded from Connext to Everclear -- same contracts
- Same EverclearSpoke address deployed across all chains
- Uses domain IDs (uint32) for destination chains, NOT EVM chain IDs
- Supports cross-chain swaps (inputAsset != outputAsset)
- `ttl` determines how long the intent is valid -- unfilled intents can be cancelled after expiry
- Finality: typically 2-15 minutes depending on solver activity
- Requires ERC-20 approval to the EverclearSpoke
- TVL: $50M+. Audited
