# Aerodrome Slipstream

Aerodrome's concentrated-liquidity pools (Uniswap V3-style, keyed by tick spacing rather than fee). Live on Arc as Aero Lite.

## Category

dex | Chains: Arc (5042)

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

## Deployed Addresses

| Chain | Contract                   | Address                                      |
| ----- | -------------------------- | -------------------------------------------- |
| Arc   | CLFactory                  | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` |
| Arc   | NonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` |
| Arc   | Metarouter                 | `0x7275FA44c67BbA8d921422e600B4ed396209c886` |

## ABI Reference

- `SlipstreamCLFactoryABI`: `getPool(address,address,int24) returns (address)`, `allPoolsLength() returns (uint256)`, `tickSpacingToFee(int24) returns (uint24)`
- `SlipstreamPositionManagerABI`: `factory() returns (address)`, `positions(uint256)`
- `AeroMetarouterABI`: `execute(bytes commands, bytes[] inputs, uint256 deadline)` - Aero's command-encoded router

## Notes

- Aero publishes no address table for Arc. Each address here is Sourcify-verified from the dromos-labs/metadex-public codebase, and the position manager reports `factory() == CLFactory`
- No voter or gauges are deployed on Arc yet, so pools there earn swap fees only
