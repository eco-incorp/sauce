<!-- Generated from the SDK's registries. Do not edit. -->

# SyncSwap (`syncswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> SyncSwap is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

DEX on zkSync Era. Supports classic constant product pools and stable pools with native account abstraction support.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Syncswap` on zksync |
| Chains | zksync |

## What it offers

- **swap**: Swap tokens via path-based routing with encoded swap data and step-based execution

## Notes

- Swap data (`data` field in steps) must be ABI-encoded off-chain: `abi.encode(tokenIn, recipient, withdrawMode)`
- `withdrawMode`: `0` = keep in vault (for chaining), `1` = withdraw to user wallet, `2` = unwrap WETH to native ETH
- Each path can have multiple steps (multi-hop), and you can include multiple paths in one transaction
- Steps support callbacks for flash-swap-like patterns (set to zero address for standard swaps)
- Pool addresses must be discovered off-chain (via SyncSwap's factory or API)
- zkSync-only deployment
- Input token must be ERC20-approved to the Router

## Its names in a program

On zkSync Era, `Syncswap` is a namespace: its contracts need no import.

```ts
function main() {
  // zkSync Era's router, `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295`.
  require(Syncswap.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../chains/zksync.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `Syncswap.Router` |

## ABI

### `SyncSwapRouterABI`

`import SyncSwapRouterABI from "./protocols/syncswap/SyncSwapRouterABI.json";` Speaks for: router.

- `swap(((address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline) payable returns ((address token, uint256 amount) amountOut)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
