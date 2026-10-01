# Across

Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.

## Category

bridge | Direction: L2-to-L2, L1-to-L2, L2-to-L1 | Chains and addresses: [registry/across.md](registry/across.md)

## SauceScript Functions

### bridge

Deposit tokens into the SpokePool for a cross-chain transfer, through `depositV3`.

```typescript
import { AcrossSpokePoolABI as ISpokePool } from "./abis";

function main(
  spokePoolAddress: Address,
  token: Address,
  outputToken: Address,
  amount: Uint256,
  outputAmount: Uint256,
  destinationChainId: Uint256,
  recipient: Address,
  quoteTimestamp: Uint256,
  fillDeadline: Uint256,
): Uint256 {
  const spokePool = ISpokePool.at(spokePoolAddress);
  spokePool.depositV3(
    ctx.msgSender(),
    recipient,
    token,
    outputToken,
    amount,
    outputAmount,
    destinationChainId,
    0x0000000000000000000000000000000000000000,
    quoteTimestamp,
    fillDeadline,
    0,
    "",
  );
  return 1;
}
```

- `token` / `outputToken`: ERC-20 to bridge, and the token the recipient receives on the destination
- `outputAmount`: amount the relayer delivers (input minus the quoted fees)
- `quoteTimestamp`: the quote's timestamp; the SpokePool rejects one outside its `depositQuoteTimeBuffer`
- `fillDeadline`: unix time after which the deposit can no longer be filled
- `recipient`: Address to receive tokens on destination chain
- Requires ERC-20 approval to the SpokePool

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/across.md](registry/across.md).

## Notes

- Fast fills: relayers fill deposits on destination within minutes, then claim reimbursement via optimistic oracle
- Finality: deposit confirmation on source chain, fill within 1-10 minutes typically
- Requires ERC-20 approval to the SpokePool address on source chain
- HubPool on Ethereum only -- SpokePools on all supported L2s
- TVL: $500M+. Audited
- On Arc (5042) the SpokePool's `wrappedNativeToken()` is the zero address, so deposit ERC-20s (USDC is `0x3600000000000000000000000000000000000000`), not native value
