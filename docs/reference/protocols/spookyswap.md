<!-- Generated from the SDK's registries. Do not edit. -->

# SpookySwap (`spookyswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> SpookySwap is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

The largest DEX on Fantom with UniV2-style constant product pools (x*y=k). Features yield farming, cross-chain bridges, and limit orders. The default trading venue on the Fantom network.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Spookyswap` on fantom |
| Chains | fantom |

## What it offers

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## Notes

- Standard Uniswap V2 fork interface; 0.2% fee per swap (lower than standard 0.3%)
- Fantom-only deployment; the dominant DEX on Fantom
- BOO token is the governance/staking token (stake for xBOO to earn fees)
- SushiSwap is also deployed on Fantom as an alternative
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity

## Its names in a program

On Fantom, `Spookyswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Fantom's v2Router, `0xF491e7B69E4244ad4002BC14e878a34207E38c29`.
  require(Spookyswap.V2Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Fantom](../chains/fantom.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `Spookyswap.V2Router` |

## ABI

### `SpookySwapRouterABI`

`import SpookySwapRouterABI from "./protocols/spookyswap/SpookySwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
