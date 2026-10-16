<!-- Generated from the SDK's registries. Do not edit. -->

# Connext (Everclear) (`connext`)

> Connext (Everclear) is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Cross-chain liquidity protocol rebranded as Everclear. Uses intents and a clearing layer for capital-efficient cross-chain transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Connext` on ethereum, optimism, base, arbitrum |
| Chains | ethereum, optimism, base, arbitrum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Its names in a program

On Ethereum, `Connext` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's everclearSpoke, `0xa05A3380889115bf313f1Db9d5f335157Be4D816`.
  require(Connext.EverclearSpoke != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Optimism](../chains/optimism.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Base](../chains/base.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Arbitrum One](../chains/arbitrum.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |

## ABI

### `EverclearSpokeABI`

`import EverclearSpokeABI from "./protocols/connext/EverclearSpokeABI.json";` Speaks for: everclearSpoke.

- `newIntent(uint32[] destinations, address receiver, address inputAsset, address outputAsset, uint256 amount, uint256 amountOutMin, uint48 ttl, bytes data) returns (bytes32 intentId, (bytes32 initiator, bytes32 receiver, bytes32 inputAsset, bytes32 outputAsset, uint32 origin, uint64 nonce, uint48 timestamp, uint48 ttl, uint256 amount, uint256 amountOutMin, uint32[] destinations, bytes data) intent)`
