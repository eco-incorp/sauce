<!-- Generated from the SDK's registries. Do not edit. -->

# Protocol globals

A program names a contract as `Namespace.Contract`: its address where a value is expected, a
bound contract where a method is called. Naming one that is not deployed on the program's chain
is a compile error. Each contract is also the compile-time define `Namespace_Contract`. A
namespace's default contract (marked) is also called as `Namespace.method(...)`. The chains each
is deployed on, with its address there, are in the protocol's registry file in `sauce-protocols`
and in each chain's file in `sauce-chains`.

## Contracts

- `AaveV2.LendingPool` ([`aave-v2`](../../sauce-protocols/references/registry/aave-v2.md), default)
- `AaveV3.Pool` ([`aave-v3`](../../sauce-protocols/references/registry/aave-v3.md), default)
- `Aerodrome.PoolFactory` ([`aerodrome`](../../sauce-protocols/references/registry/aerodrome.md))
- `Aerodrome.Router` ([`aerodrome`](../../sauce-protocols/references/registry/aerodrome.md))
- `Cctp.TokenMessenger` ([`cctp`](../../sauce-protocols/references/registry/cctp.md), default)
- `CompoundV3.CometUSDC` ([`compound-v3`](../../sauce-protocols/references/registry/compound-v3.md))
- `CompoundV3.CometUSDT` ([`compound-v3`](../../sauce-protocols/references/registry/compound-v3.md))
- `CompoundV3.CometWETH` ([`compound-v3`](../../sauce-protocols/references/registry/compound-v3.md))
- `MorphoBlue.Morpho` ([`morpho-blue`](../../sauce-protocols/references/registry/morpho-blue.md), default)
- `Oneinch.AggregationRouterV6` ([`oneinch`](../../sauce-protocols/references/registry/oneinch.md), default)
- `PancakeswapV2.Factory` ([`pancakeswap-v2`](../../sauce-protocols/references/registry/pancakeswap-v2.md))
- `PancakeswapV2.Router` ([`pancakeswap-v2`](../../sauce-protocols/references/registry/pancakeswap-v2.md))
- `Pendle.Router` ([`pendle`](../../sauce-protocols/references/registry/pendle.md), default)
- `Permit2.Permit2` ([`permit2`](../../sauce-protocols/references/registry/permit2.md), default)
- `SushiswapV2.Factory` ([`sushiswap-v2`](../../sauce-protocols/references/registry/sushiswap-v2.md))
- `SushiswapV2.Router` ([`sushiswap-v2`](../../sauce-protocols/references/registry/sushiswap-v2.md))
- `UniswapV2.Factory` ([`uniswap-v2`](../../sauce-protocols/references/registry/uniswap-v2.md))
- `UniswapV2.Router` ([`uniswap-v2`](../../sauce-protocols/references/registry/uniswap-v2.md))
- `UniswapV3.Factory` ([`uniswap-v3`](../../sauce-protocols/references/registry/uniswap-v3.md))
- `UniswapV3.NonfungiblePositionManager` ([`uniswap-v3`](../../sauce-protocols/references/registry/uniswap-v3.md))
- `UniswapV3.QuoterV2` ([`uniswap-v3`](../../sauce-protocols/references/registry/uniswap-v3.md))
- `UniswapV3.SwapRouter` ([`uniswap-v3`](../../sauce-protocols/references/registry/uniswap-v3.md))
- `UniswapV3.SwapRouter02` ([`uniswap-v3`](../../sauce-protocols/references/registry/uniswap-v3.md))
- `UniswapV4.PoolManager` ([`uniswap-v4`](../../sauce-protocols/references/registry/uniswap-v4.md))
- `UniswapV4.PositionManager` ([`uniswap-v4`](../../sauce-protocols/references/registry/uniswap-v4.md))
- `UniswapV4.UniversalRouter` ([`uniswap-v4`](../../sauce-protocols/references/registry/uniswap-v4.md))

## Family aliases

A family names a contract when exactly one of its members has it on the program's chain. Any
other name, such as one that two members share, is ambiguous: name the versioned namespace.

- `Aave.LendingPool` → `AaveV2.LendingPool`: ethereum, polygon, avalanche
- `Aave.Pool` → `AaveV3.Pool`: ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll
- `Compound.CometUSDC` → `CompoundV3.CometUSDC`: ethereum, optimism, polygon, base, arbitrum, scroll
- `Compound.CometUSDT` → `CompoundV3.CometUSDT`: ethereum, arbitrum
- `Compound.CometWETH` → `CompoundV3.CometWETH`: ethereum, base
- `Pancakeswap.Factory` → `PancakeswapV2.Factory`: ethereum, bsc, monad, opbnb, base, arbitrum, linea
- `Pancakeswap.Router` → `PancakeswapV2.Router`: ethereum, bsc, monad, opbnb, base, arbitrum, linea
- `Sushiswap.Factory` → `SushiswapV2.Factory`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche
- `Sushiswap.Router` → `SushiswapV2.Router`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche
- `Uniswap.NonfungiblePositionManager` → `UniswapV3.NonfungiblePositionManager`: ethereum, optimism, polygon, monad, arc, base, arbitrum
- `Uniswap.PoolManager` → `UniswapV4.PoolManager`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast
- `Uniswap.PositionManager` → `UniswapV4.PositionManager`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche
- `Uniswap.QuoterV2` → `UniswapV3.QuoterV2`: ethereum, monad, arc
- `Uniswap.Router` → `UniswapV2.Router`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora
- `Uniswap.SwapRouter` → `UniswapV3.SwapRouter`: ethereum, optimism, polygon, arbitrum
- `Uniswap.SwapRouter02` → `UniswapV3.SwapRouter02`: ethereum, bsc, monad, arc, base, celo, avalanche
- `Uniswap.UniversalRouter` → `UniswapV4.UniversalRouter`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche
