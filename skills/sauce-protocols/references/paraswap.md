# ParaSwap

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Multi-chain DEX aggregator routing swaps across decentralized exchanges. Supports limit orders and the Delta algorithm.

## Category

aggregator | Chains and addresses: [registry/paraswap.md](registry/paraswap.md)

## Key Operations

- **simpleSwap**: Execute a simple single-path swap via Augustus router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Note: ParaSwap requires off-chain route computation via API before on-chain execution.
// The simpleSwap function uses complex tuple params populated from API response.
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/paraswap.md](registry/paraswap.md).

## Notes

- Augustus V6 is deployed on every chain the registry lists; Augustus V5's address holds the router everywhere but Base
- On Base, Augustus V5's address is not the router: it is a small fee-splitting contract that dispatches none of the router's functions. A call carrying no value reverts; a call carrying value, `simpleSwap` included, succeeds without swapping, and the value goes to two accounts the contract fixed when it was deployed (98.5% and 1.5%). Do not send it anything; on Base the router is Augustus V6
- Route computation happens off-chain via ParaSwap API - callees/exchangeData come from API
- Approve srcToken to Augustus contract before swapping
