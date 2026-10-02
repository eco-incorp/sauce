# Aerodrome Slipstream

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Aerodrome's concentrated-liquidity pools (Uniswap V3-style, keyed by tick spacing rather than fee), on Base and, as Aero Lite, on Arc.

## Category

dex | Chains and addresses: [registry/aerodrome-slipstream.md](registry/aerodrome-slipstream.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### getPool

```typescript
import { SlipstreamCLFactoryABI as ICLFactory } from "./abis";

function main(
  factoryAddress: Address,
  tokenA: Address,
  tokenB: Address,
  tickSpacing: Uint256,
): Address {
  const factory = ICLFactory.at(factoryAddress);
  return factory.getPool(tokenA, tokenB, tickSpacing);
}
```

- Pools are keyed by `(tokenA, tokenB, tickSpacing)` within one factory
- On Base, **ask every CLFactory**: each generation keeps its own pools, so a pair can have a pool at the same tick spacing under more than one. The WETH/USDC tick-spacing-50 pool exists under all three factories, tick spacing 1 under the initial and Gauges V3 ones, and tick spacing 100 under the initial one only
- **The fee is per pool and changes over time**: read the pool's `fee()` (selector `0xddca3f43`, in millionths) when it matters. The same pair at the same tick spacing can charge different fees under different factories, and `tickSpacingToFee(tickSpacing)` is only the factory's default for a spacing: Base's WETH/USDC pools charge other fees than it

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aerodrome-slipstream.md](registry/aerodrome-slipstream.md).

## Notes

- Base's addresses are from the aerodrome-finance/slipstream README. Three generations are live there, and new gauges deploy from Gauges V3. Base has no Metarouter
- The `aerodrome` module carries Aerodrome's basic (stable/volatile) pools on Base; this one carries only Slipstream. Velodrome's Slipstream on Optimism and the Superchain is not in either
- Aero publishes no address table for Arc. Each address here is Sourcify-verified from the dromos-labs/metadex-public codebase, and the position manager reports `factory() == CLFactory`
- No voter or gauges are deployed on Arc yet, so pools there earn swap fees only
- The Base roles are `clFactory`/`nonfungiblePositionManager` (initial), `clFactoryGaugeCaps`/`nonfungiblePositionManagerGaugeCaps` and `clFactoryGaugesV3`/`nonfungiblePositionManagerGaugesV3`.
