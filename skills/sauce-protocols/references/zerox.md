# 0x Protocol

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.

## Category

aggregator | Chains and addresses: [registry/zerox.md](registry/zerox.md)

## Key Operations

- **transformERC20**: Execute a token swap via the Exchange Proxy transformer pipeline

## SauceScript Examples

```typescript
// Note: 0x requires off-chain route computation via 0x API before on-chain execution.
// The transformERC20 function uses transformations array populated from API response.
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/zerox.md](registry/zerox.md).

## Notes

- Same Exchange Proxy address across all 7 chains
- Uses transformer pipeline architecture - each swap is a sequence of transformations
- Route computation happens via 0x API - transformations array comes from API response
- Approve inputToken to exchangeProxy before swapping
- 0x API provides the optimal route, slippage protection, and transformer calldata
