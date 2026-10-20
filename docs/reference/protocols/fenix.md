<!-- Generated from the SDK's registries. Do not edit. -->

# Fenix (`fenix`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Fenix is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Blast-native ve(3,3) DEX and liquidity hub. Solidly-fork with concentrated liquidity and gauge voting, leveraging Blast's native yield on ETH and USDB for enhanced LP returns.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Fenix` on blast |
| Chains | blast |

## What it offers

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: FNX token holders vote-lock to direct gauge emissions
- Blast-only deployment; leverages Blast's native yield on ETH and USDB for additional LP returns
- For concentrated liquidity swaps on Blast, consider Thruster (Uniswap V3 fork)
- LP tokens can be staked in gauges for FNX emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On Blast, `Fenix` is a namespace: its contracts need no import.

```ts
function main() {
  // Blast's router, `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE`.
  require(Fenix.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../chains/blast.md) | router | `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE` | `Fenix.Router` |

## ABI

### `FenixRouterABI`

`import FenixRouterABI from "./protocols/fenix/FenixRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
