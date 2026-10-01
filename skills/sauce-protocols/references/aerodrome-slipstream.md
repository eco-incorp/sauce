# Aerodrome Slipstream

Aerodrome's concentrated-liquidity pools (Uniswap V3-style, keyed by tick spacing rather than fee), on Base and, as Aero Lite, on Arc.

## Category

dex | Chains: Base (8453), Arc (5042)

## SauceScript Functions

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

- Pools are keyed by `(tokenA, tokenB, tickSpacing)`. `tickSpacingToFee(tickSpacing)` gives a spacing's default fee
- On Base, ask the factory of the generation the pool was created in: a pool exists under one CLFactory only (the WETH/USDC tick-spacing-100 pool is under the initial one)

## Deployed Addresses

| Chain | Contract                                | Address                                      |
| ----- | --------------------------------------- | -------------------------------------------- |
| Base  | CLFactory (initial)                     | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` |
| Base  | NonfungiblePositionManager (initial)    | `0x827922686190790b37229fd06084350E74485b72` |
| Base  | CLFactory (Gauge Caps)                  | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` |
| Base  | NonfungiblePositionManager (Gauge Caps) | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` |
| Base  | CLFactory (Gauges V3)                   | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` |
| Base  | NonfungiblePositionManager (Gauges V3)  | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` |
| Arc   | CLFactory                               | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` |
| Arc   | NonfungiblePositionManager              | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` |
| Arc   | Metarouter                              | `0x7275FA44c67BbA8d921422e600B4ed396209c886` |

The Base roles are `clFactory`/`nonfungiblePositionManager` (initial), `clFactoryGaugeCaps`/`nonfungiblePositionManagerGaugeCaps` and `clFactoryGaugesV3`/`nonfungiblePositionManagerGaugesV3`.

## ABI Reference

- `SlipstreamCLFactoryABI`: `getPool(address,address,int24) returns (address)`, `allPoolsLength() returns (uint256)`, `tickSpacingToFee(int24) returns (uint24)`
- `SlipstreamPositionManagerABI`: `factory() returns (address)`, `positions(uint256)`
- `AeroMetarouterABI`: `execute(bytes commands, bytes[] inputs, uint256 deadline)` - Aero's command-encoded router

## Notes

- Base's addresses are from the aerodrome-finance/slipstream README. Three generations are live there, and new gauges deploy from Gauges V3. Base has no Metarouter
- The `aerodrome` module carries Aerodrome's basic (stable/volatile) pools on Base; this one carries only Slipstream. Velodrome's Slipstream on Optimism and the Superchain is not in either
- Aero publishes no address table for Arc. Each address here is Sourcify-verified from the dromos-labs/metadex-public codebase, and the position manager reports `factory() == CLFactory`
- No voter or gauges are deployed on Arc yet, so pools there earn swap fees only
