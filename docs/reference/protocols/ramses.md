<!-- Generated from the SDK's registries. Do not edit. -->

# Ramses (`ramses`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Ramses is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Arbitrum-native ve(3,3) DEX with concentrated liquidity support. Features gauge voting, bribes, and protocol-owned liquidity mechanisms. Solidly-fork architecture.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ramses` on arbitrum |
| Chains | arbitrum |

## What it offers

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: RAM token holders vote-lock to direct gauge emissions and receive bribes
- Arbitrum-only deployment; competes with Camelot on Arbitrum
- Ramses also has concentrated liquidity pools (CL) but the SDK currently exposes the V2 Solidly interface
- LP tokens can be staked in gauges for RAM emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On Arbitrum One, `Ramses` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's router, `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e`.
  require(Ramses.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `Ramses.Router` |

## ABI

### `RamsesRouterABI`

`import RamsesRouterABI from "./protocols/ramses/RamsesRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
