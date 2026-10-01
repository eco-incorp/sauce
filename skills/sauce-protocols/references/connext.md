# Connext (Everclear)

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

## Category

bridge | Direction: any-to-any (L2-to-L2, L1-to-L2, L2-to-L1) | Chains and addresses: [registry/connext.md](registry/connext.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/connext.md](registry/connext.md).

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
