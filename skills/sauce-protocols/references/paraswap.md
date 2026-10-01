# ParaSwap

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

## Category

aggregator | Chains and addresses: [registry/paraswap.md](registry/paraswap.md)

## Key Operations

- **simpleSwap**: Execute a simple single-path swap via Augustus router

## SauceScript Examples

```typescript
// Note: ParaSwap requires off-chain route computation via API before on-chain execution.
// The simpleSwap function uses complex tuple params populated from API response.
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/paraswap.md](registry/paraswap.md).

## Notes

- Augustus V5 and V6 both deployed on all chains
- Delta algorithm protects against MEV/sandwich attacks
- Route computation happens off-chain via ParaSwap API - callees/exchangeData come from API
- Approve srcToken to Augustus contract before swapping
- V6 is newer but V5 is more widely integrated
