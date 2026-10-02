# Synapse Protocol

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

## Category

bridge | Direction: any-to-any (L1-to-L2, L2-to-L2, L2-to-L1) | Chains and addresses: [registry/synapse.md](registry/synapse.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/synapse.md](registry/synapse.md).

## Notes

- `deposit`: For canonical tokens supported directly by the bridge
- `depositAndSwap`: For bridging with an automatic swap on destination (e.g. bridge nUSD, swap to USDC on arrival)
- `redeem`: For synthetic bridge tokens (nUSD, nETH) -- burns on source, mints on destination
- Also supports CCTP-based USDC bridging via separate cctpRouter contract
- Finality: typically 5-15 minutes depending on route
- Requires ERC-20 approval to the SynapseBridge
- TVL: $100M+. Audited
