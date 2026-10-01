# Celer Network

Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.

## Category

bridge | Direction: any-to-any (L1-to-L2, L2-to-L2, L2-to-L1) | Chains and addresses: [registry/celer.md](registry/celer.md)

## SauceScript Functions

### bridge

Send ERC-20 tokens cross-chain via cBridge.

```typescript
import { CelerBridgeABI as IBridge } from "./abis";

function main(
  bridgeAddress: Address,
  receiver: Address,
  token: Address,
  amount: Uint256,
  dstChainId: Uint256,
  maxSlippage: Uint256,
): Uint256 {
  const bridge = IBridge.at(bridgeAddress);
  bridge.send(receiver, token, amount, dstChainId, 0, maxSlippage);
  return 1;
}
```

- `receiver`: Address to receive tokens on destination chain
- `token`: ERC-20 token to bridge
- `dstChainId`: Destination EVM chain ID (as uint64)
- `nonce`: Set to 0 (auto-generated)
- `maxSlippage`: Maximum slippage in basis points (e.g. 500 = 5%). Applied during pool-based bridging
- Requires ERC-20 approval to the Bridge

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/celer.md](registry/celer.md).

## Notes

- `send` for ERC-20 tokens, `sendNative` for native tokens (ETH, BNB, AVAX, etc.)
- `nonce` is used for unique transfer identification -- can set to 0 or use block.timestamp
- `maxSlippage` is in basis points (1 = 0.01%, 100 = 1%, 5000 = 50%)
- Uses SGN validators to verify cross-chain messages
- Finality: typically 5-20 minutes depending on chain confirmation requirements
- Requires ERC-20 approval to the Bridge address
- TVL: $150M+. Audited
