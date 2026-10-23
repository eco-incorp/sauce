<!-- Generated from the SDK's registries. Do not edit. -->

# Kim (`kim`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Kim is an exchange: people swap one token for another in its pools. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Mode-native DEX. Its V2 router is a Camelot fork: swaps take a plain token path and a referrer, and support fee-on-transfer tokens. Offers farming incentives on Mode Network.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kim` on mode |
| Chains | mode |

## What it offers

- **swap**: Swap tokens along a token path

## Notes

- Mode-only deployment
- Mode Network features native yield sharing via Sequencer Fee Sharing (SFS)
- LP tokens can be staked for farming rewards
- Input token must be ERC20-approved to the Router

## Its names in a program

On Mode, `Kim` is a namespace: its contracts need no import.

```ts
function main() {
  // Mode's v2Router, `0x5D61c537393cf21893BE619E36fC94cd73C77DD3`.
  require(Kim.V2Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Mode](../chains/mode.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

## ABI

### `KimRouterABI`

`import KimRouterABI from "./protocols/kim/KimRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
