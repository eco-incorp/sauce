<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome Slipstream (`aerodrome-slipstream`)

Aerodrome's concentrated-liquidity (Uniswap V3-style) pools, keyed by tick spacing rather than fee: three generations on Base, and Aero Lite on Arc.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `AerodromeSlipstream` on arc, base |
| Chains | arc, base |
| Document | [aerodrome-slipstream.md](../aerodrome-slipstream.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arc, `AerodromeSlipstream` is a namespace: its contracts need no import.

```sauce chain=arc
function main() {
  // Arc's clFactory, `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03`.
  require(AerodromeSlipstream.CLFactory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | clFactory | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` | `AerodromeSlipstream.CLFactory` |
| [Arc](../../../sauce-chains/references/arc.md) | metarouter | `0x7275FA44c67BbA8d921422e600B4ed396209c886` | `AerodromeSlipstream.Metarouter` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | clFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `AerodromeSlipstream.CLFactory` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugeCaps | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | `AerodromeSlipstream.CLFactoryGaugeCaps` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugesV3 | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | `AerodromeSlipstream.CLFactoryGaugesV3` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugeCaps | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | `AerodromeSlipstream.NonfungiblePositionManagerGaugeCaps` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugesV3 | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | `AerodromeSlipstream.NonfungiblePositionManagerGaugesV3` |

## ABI

### `AeroMetarouterABI`

`import AeroMetarouterABI from "./protocols/aerodrome-slipstream/AeroMetarouterABI.json";` Speaks for: metarouter.

- `execute(bytes _commands, bytes[] _inputs, uint256 _deadline) payable`

### `AerodromeSlipstreamPoolABI`

`import AerodromeSlipstreamPoolABI from "./protocols/aerodrome-slipstream/AerodromeSlipstreamPoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `SlipstreamCLFactoryABI`

`import SlipstreamCLFactoryABI from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";` Speaks for: clFactory, clFactoryGaugeCaps, clFactoryGaugesV3.

- `getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)`
- `allPoolsLength() view returns (uint256)`
- `tickSpacingToFee(int24) view returns (uint24)`

### `SlipstreamPositionManagerABI`

`import SlipstreamPositionManagerABI from "./protocols/aerodrome-slipstream/SlipstreamPositionManagerABI.json";` Speaks for: nonfungiblePositionManager, nonfungiblePositionManagerGaugeCaps, nonfungiblePositionManagerGaugesV3.

- `factory() view returns (address)`
- `positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
