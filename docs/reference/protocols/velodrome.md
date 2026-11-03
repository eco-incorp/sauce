<!-- Generated from the SDK's registries. Do not edit. -->

# Velodrome (`velodrome`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Velodrome is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

DEX on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable (correlated assets) and volatile (uncorrelated assets) pool types.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Velodrome` on optimism |
| Chains | optimism |

## What it offers

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

## Notes

- Two pool types: `stable=true` for correlated assets (uses Curve-like invariant), `stable=false` for uncorrelated (uses x*y=k)
- Fees: volatile pools typically 0.3%, stable pools typically 0.04% (set by governance)
- ve(3,3) model: VELO holders vote-lock tokens to direct gauge emissions to pools weekly
- Routes include both `stable` flag and `factory` address per hop
- Optimism-only deployment; Aerodrome is the Base equivalent (same interface)
- LP tokens can be staked in gauges for VELO emissions

## Its names in a program

On Optimism, `Velodrome` is a namespace: its contracts need no import.

```ts
function main() {
  // Optimism's poolFactory, `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a`.
  require(Velodrome.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../chains/optimism.md) | poolFactory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | `Velodrome.PoolFactory` |
| [Optimism](../chains/optimism.md) | routerV2 | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` | `Velodrome.RouterV2` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `VelodromePoolABI`

`import VelodromePoolABI from "./protocols/velodrome/VelodromePoolABI.json";`

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blockTimestampLast() view returns (uint256)`
- `burn(address to) returns (uint256 amount0, uint256 amount1)`
- `claimable0(address) view returns (uint256)`
- `claimable1(address) view returns (uint256)`
- `claimFees() returns (uint256 claimed0, uint256 claimed1)`
- `currentCumulativePrices() view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `factory() view returns (address)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `index0() view returns (uint256)`
- `index1() view returns (uint256)`
- `initialize(address _token0, address _token1, bool _stable)`
- `lastObservation() view returns ((uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative))`
- `metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)`
- `mint(address to) returns (uint256 liquidity)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `observationLength() view returns (uint256)`
- `observations(uint256) view returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `poolFees() view returns (address)`
- `prices(address tokenIn, uint256 amountIn, uint256 points) view returns (uint256[])`
- `quote(address tokenIn, uint256 amountIn, uint256 granularity) view returns (uint256 amountOut)`
- `reserve0() view returns (uint256)`
- `reserve0CumulativeLast() view returns (uint256)`
- `reserve1() view returns (uint256)`
- `reserve1CumulativeLast() view returns (uint256)`
- `sample(address tokenIn, uint256 amountIn, uint256 points, uint256 window) view returns (uint256[])`
- `setName(string __name)`
- `setSymbol(string __symbol)`
- `skim(address to)`
- `stable() view returns (bool)`
- `supplyIndex0(address) view returns (uint256)`
- `supplyIndex1(address) view returns (uint256)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`
- `symbol() view returns (string)`
- `sync()`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `tokens() view returns (address, address)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`

Left out of this ABI, though its deployments declare them:

- `error BelowMinimumK` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DepositsNotEqual` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FactoryAlreadySet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientLiquidityMinted` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTo` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `VelodromePoolFactoryABI`

`import VelodromePoolFactoryABI from "./protocols/velodrome/VelodromePoolFactoryABI.json";` Speaks for: poolFactory. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Velodrome` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `allPools(uint256) view returns (address)`
- `allPoolsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB, bool stable) returns (address pool)`
- `createPool(address tokenA, address tokenB, bool stable) returns (address pool)`
- `customFee(address) view returns (uint256)`
- `feeManager() view returns (address)`
- `getFee(address pool, bool _stable) view returns (uint256)`
- `getPair(address tokenA, address tokenB, bool stable) view returns (address)`
- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`: the address is a `Velodrome.Pool`
- `implementation() view returns (address)`
- `isPair(address pool) view returns (bool)`
- `isPaused() view returns (bool)`
- `isPool(address pool) view returns (bool)`
- `MAX_FEE() view returns (uint256)`
- `pauser() view returns (address)`
- `setCustomFee(address pool, uint256 fee)`
- `setFee(bool _stable, uint256 _fee)`
- `setFeeManager(address _feeManager)`
- `setPauser(address _pauser)`
- `setPauseState(bool _state)`
- `setSinkConverter(address _sinkConverter, address _velo, address _veloV2)`
- `setVoter(address _voter)`
- `sinkConverter() view returns (address)`
- `stableFee() view returns (uint256)`
- `velo() view returns (address)`
- `veloV2() view returns (address)`
- `volatileFee() view returns (uint256)`
- `voter() view returns (address)`
- `ZERO_FEE_INDICATOR() view returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `createPool` taking `(address,address,uint24)`: an overload of createPool(address,address,bool), which takes as many arguments: a call picks its overload by argument count.
- `error InvalidPool` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotSinkConverter` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PoolAlreadyExists` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `getPool` taking `(address,address,uint24)`: an overload of getPool(address,address,bool), which takes as many arguments: a call picks its overload by argument count.

### `VelodromeRouterABI`

`import VelodromeRouterABI from "./protocols/velodrome/VelodromeRouterABI.json";` Speaks for: routerV2. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Velodrome` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, bool stable, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `defaultFactory() view returns (address)`
- `ETHER() view returns (address)`
- `factoryRegistry() view returns (address)`
- `generateZapInParams(address tokenA, address tokenB, bool stable, address _factory, uint256 amountInA, uint256 amountInB, (address from, address to, bool stable, address factory)[] routesA, (address from, address to, bool stable, address factory)[] routesB) view returns (uint256 amountOutMinA, uint256 amountOutMinB, uint256 amountAMin, uint256 amountBMin)`
- `generateZapOutParams(address tokenA, address tokenB, bool stable, address _factory, uint256 liquidity, (address from, address to, bool stable, address factory)[] routesA, (address from, address to, bool stable, address factory)[] routesB) view returns (uint256 amountOutMinA, uint256 amountOutMinB, uint256 amountAMin, uint256 amountBMin)`
- `getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)`
- `getReserves(address tokenA, address tokenB, bool stable, address _factory) view returns (uint256 reserveA, uint256 reserveB)`
- `isTrustedForwarder(address forwarder) view returns (bool)`
- `pairFor(address tokenA, address tokenB, bool stable, address _factory) view returns (address pool)`
- `poolFor(address tokenA, address tokenB, bool stable, address _factory) view returns (address pool)`
- `quoteAddLiquidity(address tokenA, address tokenB, bool stable, address _factory, uint256 amountADesired, uint256 amountBDesired) view returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, address _factory, uint256 liquidity) view returns (uint256 amountA, uint256 amountB)`
- `quoteStableLiquidityRatio(address tokenA, address tokenB, address _factory) view returns (uint256 ratio)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)`
- `sortTokens(address tokenA, address tokenB) pure returns (address token0, address token1)`
- `swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) payable`
- `swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline)`
- `UNSAFE_swapExactTokensForTokens(uint256[] amounts, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[])`
- `v1Factory() view returns (address)`
- `voter() view returns (address)`
- `weth() view returns (address)`
- `zapIn(address tokenIn, uint256 amountInA, uint256 amountInB, (address tokenA, address tokenB, bool stable, address factory, uint256 amountOutMinA, uint256 amountOutMinB, uint256 amountAMin, uint256 amountBMin) zapInPool, (address from, address to, bool stable, address factory)[] routesA, (address from, address to, bool stable, address factory)[] routesB, address to, bool stake) payable returns (uint256 liquidity)`
- `zapOut(address tokenOut, uint256 liquidity, (address tokenA, address tokenB, bool stable, address factory, uint256 amountOutMinA, uint256 amountOutMinB, uint256 amountAMin, uint256 amountBMin) zapOutPool, (address from, address to, bool stable, address factory)[] routesA, (address from, address to, bool stable, address factory)[] routesB)`

Left out of this ABI, though its deployments declare them:

- `error Expired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAmountA` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAmountADesired` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAmountAOptimal` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAmountB` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAmountInForETHDeposit` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidRouteA` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidRouteB` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PoolDoesNotExist` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PoolFactoryDoesNotExist` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SameAddresses` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
