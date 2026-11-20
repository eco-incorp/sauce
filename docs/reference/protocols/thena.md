<!-- Generated from the SDK's registries. Do not edit. -->

# Thena (`thena`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Thena is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

BSC-native liquidity layer with ve(3,3) tokenomics. Solidly-fork supporting both volatile (x*y=k) and stable (Curve-like) AMM pools with gauge voting for directing emissions.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thena` on bsc |
| Chains | bsc |

## What it offers

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: THE token holders vote-lock to direct gauge emissions weekly
- BSC-only deployment; competes with PancakeSwap on BSC
- LP tokens can be staked in gauges for THE emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On BNB Chain, `Thena` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's routerV2, `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109`.
  require(Thena.RouterV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | routerV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` | `Thena.RouterV2` |

## ABI

### `ThenaRouterABI`

`import ThenaRouterABI from "./protocols/thena/ThenaRouterABI.json";` Speaks for: routerV2. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Thena` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, bool stable, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `factory() view returns (address)`
- `getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) view returns (uint256 amount, bool stable)`
- `getAmountsOut(uint256 amountIn, (address from, address to, bool stable)[] routes) view returns (uint256[] amounts)`
- `getReserves(address tokenA, address tokenB, bool stable) view returns (uint256 reserveA, uint256 reserveB)`
- `isPair(address pair) view returns (bool)`
- `pairFor(address tokenA, address tokenB, bool stable) view returns (address pair)`
- `quoteAddLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired) view returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity) view returns (uint256 amountA, uint256 amountB)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermit(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, bool stable, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityWithPermit(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)`
- `sortTokens(address tokenA, address tokenB) pure returns (address token0, address token1)`
- `swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) payable`
- `swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForTokensSimple(uint256 amountIn, uint256 amountOutMin, address tokenFrom, address tokenTo, bool stable, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline)`
- `UNSAFE_swapExactTokensForTokens(uint256[] amounts, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[])`
- `wETH() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
