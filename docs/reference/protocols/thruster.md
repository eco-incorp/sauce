<!-- Generated from the SDK's registries. Do not edit. -->

# Thruster (`thruster`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Thruster is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Blast-native DEX with concentrated liquidity (V3-style) pools. Optimized for Blast's native yield on ETH and USDB, and gas rebate features. Fork of Uniswap V3 architecture.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thruster` on blast |
| Chains | blast |

## What it offers

- **swap**: Exact input single-hop swap with fee tier selection via V3 SwapRouter

## Notes

- Standard Uniswap V3 fork interface with identical parameter naming
- Blast-only deployment
- Leverages Blast's native yield: ETH and USDB in pools automatically earn native yield
- Gas rebates from Blast's gas monetization feature benefit traders
- Input token must be ERC20-approved to the V3 SwapRouter
- For Blast DEX swaps, also consider Fenix (ve(3,3) Solidly-fork) for stable pairs

## Its names in a program

On Blast, `Thruster` is a namespace: its contracts need no import.

```ts
function main() {
  // Blast's v3SwapRouter, `0x337827814155ECBf24D20231fCA4444F530C0555`.
  require(Thruster.V3SwapRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../chains/blast.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530C0555` | `Thruster.V3SwapRouter` |

## ABI

### `ThrusterV3SwapRouterABI`

`import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
