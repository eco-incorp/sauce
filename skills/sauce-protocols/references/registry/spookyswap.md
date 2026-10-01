<!-- Generated from the SDK's registries. Do not edit. -->

# SpookySwap (`spookyswap`)

The largest DEX on Fantom with UniV2-style constant product pools. Features yield farming, bridges, and limit orders.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | fantom |
| Document | [spookyswap.md](../spookyswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Fantom's v2Router):

```sauce chain=fantom
import SpookySwapRouterABI from "./protocols/spookyswap/SpookySwapRouterABI.json";

const V2_ROUTER = 0xF491e7B69E4244ad4002BC14e878a34207E38c29n;

function main() {
  const bound = SpookySwapRouterABI.at(V2_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Fantom](../../../sauce-chains/references/fantom.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `SpookySwapRouterABI.at(0xF491e7B69E4244ad4002BC14e878a34207E38c29n)` |

## ABI

### `SpookySwapRouterABI`

`import SpookySwapRouterABI from "./protocols/spookyswap/SpookySwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
