<!-- Generated from the SDK's registries. Do not edit. -->

# Thena (`thena`)

BSC-native liquidity layer with ve(3,3) tokenomics. Solidly-fork supporting both volatile and stable AMM pools with gauge voting.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thena` on bsc |
| Chains | bsc |
| Document | [thena.md](../thena.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `Thena` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's routerV2, `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109`.
  require(Thena.RouterV2 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | routerV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` | `Thena.RouterV2` |

## ABI

### `ThenaRouterABI`

`import ThenaRouterABI from "./protocols/thena/ThenaRouterABI.json";` Speaks for: routerV2.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
