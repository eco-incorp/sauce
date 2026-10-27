<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome Slipstream (`aerodrome-slipstream`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aerodrome Slipstream is an exchange: people swap one token for another in its pools. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Aerodrome's concentrated-liquidity pools (Uniswap V3-style, keyed by tick spacing rather than fee), on Base and, as Aero Lite, on Arc.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `AerodromeSlipstream` on arc, base |
| Chains | arc, base |

## Notes

- Base's addresses are from the aerodrome-finance/slipstream README. Three generations are live there, and new gauges deploy from Gauges V3. Base has no Metarouter
- The `aerodrome` module carries Aerodrome's basic (stable/volatile) pools on Base; this one carries only Slipstream. Velodrome's Slipstream on Optimism and the Superchain is not in either
- Aero publishes no address table for Arc. Each address here is Sourcify-verified from the dromos-labs/metadex-public codebase, and the position manager reports `factory() == CLFactory`
- No voter or gauges are deployed on Arc yet, so pools there earn swap fees only
- From a Pot program, `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` swaps a Slipstream pool: it calls the Pot's Router, which answers the pool's `uniswapV3SwapCallback` from the Pot. Find the pool with a CLFactory's `getPool(tokenA, tokenB, tickSpacing)`: on Arc the one factory, `AerodromeSlipstream.CLFactory.getPool(...)`; on Base ask each CLFactory (above), such as `AerodromeSlipstream.CLFactoryGaugesV3.getPool(...)`, which Arc does not have. The classic Aerodrome Router and its stable/volatile pools (`aerodrome`) are Base's only
- The Base roles are `clFactory`/`nonfungiblePositionManager` (initial), `clFactoryGaugeCaps`/`nonfungiblePositionManagerGaugeCaps` and `clFactoryGaugesV3`/`nonfungiblePositionManagerGaugesV3`.

## Its names in a program

On Arc, `AerodromeSlipstream` is a namespace: its contracts need no import.

```ts
function main() {
  // Arc's clFactory, `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03`.
  require(AerodromeSlipstream.CLFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../chains/arc.md) | clFactory | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` | `AerodromeSlipstream.CLFactory` |
| [Arc](../chains/arc.md) | metarouter | `0x7275fA44c67bba8D921422e600b4Ed396209C886` | `AerodromeSlipstream.Metarouter` |
| [Arc](../chains/arc.md) | nonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../chains/base.md) | clFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `AerodromeSlipstream.CLFactory` |
| [Base](../chains/base.md) | clFactoryGaugeCaps | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | `AerodromeSlipstream.CLFactoryGaugeCaps` |
| [Base](../chains/base.md) | clFactoryGaugesV3 | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | `AerodromeSlipstream.CLFactoryGaugesV3` |
| [Base](../chains/base.md) | nonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../chains/base.md) | nonfungiblePositionManagerGaugeCaps | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | `AerodromeSlipstream.NonfungiblePositionManagerGaugeCaps` |
| [Base](../chains/base.md) | nonfungiblePositionManagerGaugesV3 | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | `AerodromeSlipstream.NonfungiblePositionManagerGaugesV3` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `AeroMetarouterABI`

`import AeroMetarouterABI from "./protocols/aerodrome-slipstream/AeroMetarouterABI.json";` Speaks for: metarouter.

- `execute(bytes _commands, bytes[] _inputs, uint256 _deadline) payable`

### `AerodromeSlipstreamPoolABI`

`import AerodromeSlipstreamPoolABI from "./protocols/aerodrome-slipstream/AerodromeSlipstreamPoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `SlipstreamCLFactoryABI`

`import SlipstreamCLFactoryABI from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";` Speaks for: clFactory, clFactoryGaugeCaps, clFactoryGaugesV3.

- `getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)`: the address is a `AerodromeSlipstream.Pool`
- `allPoolsLength() view returns (uint256)`
- `tickSpacingToFee(int24) view returns (uint24)`

### `SlipstreamPositionManagerABI`

`import SlipstreamPositionManagerABI from "./protocols/aerodrome-slipstream/SlipstreamPositionManagerABI.json";` Speaks for: nonfungiblePositionManager, nonfungiblePositionManagerGaugeCaps, nonfungiblePositionManagerGaugesV3.

- `factory() view returns (address)`: the address is a `AerodromeSlipstream.CLFactory`
- `positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
