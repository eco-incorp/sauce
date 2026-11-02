<!-- Generated from the SDK's registries. Do not edit. -->

# Ramses (`ramses`)

Arbitrum-native ve(3,3) DEX with concentrated liquidity. Features gauge voting, bribes, and protocol-owned liquidity mechanisms.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ramses` on arbitrum |
| Chains | arbitrum |
| Document | [ramses.md](../ramses.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Ramses` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's router, `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e`.
  require(Ramses.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `Ramses.Router` |

## ABI

### `RamsesRouterABI`

`import RamsesRouterABI from "./protocols/ramses/RamsesRouterABI.json";` Speaks for: router. The import is the contract's full ABI across every deployment; call it through the `Ramses` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, bool stable, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `factory() view returns (address)`
- `getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) view returns (uint256 amount, bool stable)`
- `getAmountsOut(uint256 amountIn, (address from, address to, bool stable)[] routes) view returns (uint256[] amounts)`
- `getReserves(address tokenA, address tokenB, bool stable) view returns (uint256 reserveA, uint256 reserveB)`
- `initialize(address _factory, address _weth)`
- `isPair(address pair) view returns (bool)`
- `pairFor(address tokenA, address tokenB, bool stable) view returns (address pair)`
- `quoteAddLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired) view returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity) view returns (uint256 amountA, uint256 amountB)`
- `recoverFunds(address token, address to, uint256 amount)`
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
- `weth() view returns (address)`
