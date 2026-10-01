<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome Slipstream (`aerodrome-slipstream`)

Aerodrome's concentrated-liquidity (Uniswap V3-style) pools, keyed by tick spacing rather than fee: three generations on Base, and Aero Lite on Arc.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arc, base |
| Document | [aerodrome-slipstream.md](../aerodrome-slipstream.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arc's clFactory):

```sauce chain=arc
import SlipstreamCLFactoryABI from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";

const CL_FACTORY = 0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03n;

function main() {
  const bound = SlipstreamCLFactoryABI.at(CL_FACTORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | clFactory | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` | `SlipstreamCLFactoryABI.at(0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03n)` |
| [Arc](../../../sauce-chains/references/arc.md) | metarouter | `0x7275FA44c67BbA8d921422e600B4ed396209c886` | `AeroMetarouterABI.at(0x7275FA44c67BbA8d921422e600B4ed396209c886n)` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` | `SlipstreamPositionManagerABI.at(0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473n)` |
| [Base](../../../sauce-chains/references/base.md) | clFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `SlipstreamCLFactoryABI.at(0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809An)` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugeCaps | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | `SlipstreamCLFactoryABI.at(0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716an)` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugesV3 | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | `SlipstreamCLFactoryABI.at(0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Efn)` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` | `SlipstreamPositionManagerABI.at(0x827922686190790b37229fd06084350E74485b72n)` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugeCaps | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | `SlipstreamPositionManagerABI.at(0xa990C6a764b73BF43cee5Bb40339c3322FB9D55Fn)` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugesV3 | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | `SlipstreamPositionManagerABI.at(0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53n)` |

## ABI

### `AeroMetarouterABI`

`import AeroMetarouterABI from "./protocols/aerodrome-slipstream/AeroMetarouterABI.json";` Speaks for: metarouter.

- `execute(bytes _commands, bytes[] _inputs, uint256 _deadline) payable`

### `SlipstreamCLFactoryABI`

`import SlipstreamCLFactoryABI from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";` Speaks for: clFactory, clFactoryGaugeCaps, clFactoryGaugesV3.

- `getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)`
- `allPoolsLength() view returns (uint256)`
- `tickSpacingToFee(int24) view returns (uint24)`

### `SlipstreamPositionManagerABI`

`import SlipstreamPositionManagerABI from "./protocols/aerodrome-slipstream/SlipstreamPositionManagerABI.json";` Speaks for: nonfungiblePositionManager, nonfungiblePositionManagerGaugeCaps, nonfungiblePositionManagerGaugesV3.

- `factory() view returns (address)`
- `positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
