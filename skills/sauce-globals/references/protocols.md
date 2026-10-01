<!-- Generated from the SDK's registries: the names `sauce globals --chain <chain>` lists. Do not edit. -->

# Protocol globals

A program names a contract as `Namespace.Contract`: its address where a value is expected, a
bound contract where a method is called. Naming one that is not deployed on the program's chain
is a compile error. Each contract is also the compile-time define `Namespace_Contract` on the
chains listed. A namespace's default contract (marked) is also called as `Namespace.method(...)`.

## Contracts

- `AaveV2.LendingPool` (`aave-v2`, default): ethereum, polygon, avalanche
- `AaveV3.Pool` (`aave-v3`, default): ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll
- `Aerodrome.PoolFactory` (`aerodrome`): base
- `Aerodrome.Router` (`aerodrome`): base
- `Cctp.TokenMessenger` (`cctp`, default): ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea
- `CompoundV3.CometUSDC` (`compound-v3`): ethereum, optimism, polygon, base, arbitrum, scroll
- `CompoundV3.CometUSDT` (`compound-v3`): ethereum, arbitrum
- `CompoundV3.CometWETH` (`compound-v3`): ethereum, base
- `MorphoBlue.Morpho` (`morpho-blue`, default): ethereum, monad, arc, base
- `Oneinch.AggregationRouterV6` (`oneinch`, default): ethereum, optimism, bsc, polygon, base, arbitrum, avalanche
- `PancakeswapV2.Factory` (`pancakeswap-v2`): ethereum, bsc, monad, opbnb, base, arbitrum, linea
- `PancakeswapV2.Router` (`pancakeswap-v2`): ethereum, bsc, monad, opbnb, base, arbitrum, linea
- `Pendle.Router` (`pendle`, default): ethereum, monad, arbitrum
- `Permit2.Permit2` (`permit2`, default): ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche
- `SushiswapV2.Factory` (`sushiswap-v2`): ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche
- `SushiswapV2.Router` (`sushiswap-v2`): ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche
- `UniswapV2.Factory` (`uniswap-v2`): ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora
- `UniswapV2.Router` (`uniswap-v2`): ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora
- `UniswapV3.Factory` (`uniswap-v3`): ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche
- `UniswapV3.NonfungiblePositionManager` (`uniswap-v3`): ethereum, optimism, polygon, monad, arc, base, arbitrum
- `UniswapV3.QuoterV2` (`uniswap-v3`): ethereum, monad, arc
- `UniswapV3.SwapRouter` (`uniswap-v3`): ethereum, optimism, polygon, arbitrum
- `UniswapV3.SwapRouter02` (`uniswap-v3`): ethereum, bsc, monad, arc, base, celo, avalanche
- `UniswapV4.PoolManager` (`uniswap-v4`): ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast
- `UniswapV4.PositionManager` (`uniswap-v4`): ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche
- `UniswapV4.UniversalRouter` (`uniswap-v4`): ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche

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
