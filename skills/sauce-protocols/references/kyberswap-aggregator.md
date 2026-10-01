# KyberSwap Aggregator

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.

## Category

aggregator | Chains and addresses: [registry/kyberswap-aggregator.md](registry/kyberswap-aggregator.md)

## Key Operations

- **swap**: Execute swap via meta aggregation router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Swap via KyberSwap meta aggregator
import { KyberSwapMetaAggregationRouterABI as IMetaAggregationRouter } from "./abis";
function main(
  routerAddress: Address,
  callTarget: Address,
  approveTarget: Address,
  targetData: bytes,
  srcToken: Address,
  dstToken: Address,
  dstReceiver: Address,
  amount: Uint256,
  minReturnAmount: Uint256,
  clientData: bytes,
): { returnAmount: Uint256; gasUsed: Uint256 } {
  const router = IMetaAggregationRouter.at(routerAddress);
  return router.swap({
    callTarget: callTarget,
    approveTarget: approveTarget,
    targetData: targetData,
    desc: {
      srcToken: srcToken,
      dstToken: dstToken,
      srcReceivers: [],
      srcAmounts: [],
      feeReceivers: [],
      feeAmounts: [],
      dstReceiver: dstReceiver,
      amount: amount,
      minReturnAmount: minReturnAmount,
      flags: 0,
      permit: 0x00,
    },
    clientData: clientData,
  });
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/kyberswap-aggregator.md](registry/kyberswap-aggregator.md).

## Notes

- TVL: $500M+. Same address on 11 of its 12 chains; zkSync's differs
- Meta-aggregates across 1inch, 0x, ParaSwap, and other aggregators
- Route computation via KyberSwap API - callTarget/targetData come from API response
- Approve srcToken to metaAggregationRouter before swapping
- On Arc (5042) the router at this address is a smaller build than Ethereum's (13724 vs 18652 bytes, a different owner, no `swapGeneric`/whitelist functions). Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts
