<!-- Generated from the SDK's registries. Do not edit. -->

# Kim (`kim`)

Mode-native DEX with UniV2-style constant product pools. The primary trading venue on Mode Network with farming incentives.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kim` on mode |
| Chains | mode |
| Document | [kim.md](../kim.md): what it is for, how to choose it, its pitfalls |

## In a program

On Mode, `Kim` is a namespace: its contracts need no import.

```sauce chain=mode
function main() {
  // Mode's v2Router, `0x5D61c537393cf21893BE619E36fC94cd73C77DD3`.
  require(Kim.V2Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Mode](../../../sauce-chains/references/mode.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

## ABI

### `KimRouterABI`

`import KimRouterABI from "./protocols/kim/KimRouterABI.json";` Speaks for: v2Router. The import is the contract's full ABI across every deployment; call it through the `Kim` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `assign(address feeSharingContract, uint256 tokenId) returns (uint256)`
- `factory() view returns (address)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
- `getPair(address token1, address token2) view returns (address)`
- `owner() view returns (address)`
- `quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)`
- `register(address feeSharingContract, address recipient) returns (uint256 tokenId)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)`
- `removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)`
- `removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)`
- `renounceOwnership()`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline) payable`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `transferOwnership(address newOwner)`
- `WETH() view returns (address)`
