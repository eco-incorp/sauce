<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap (`kyberswap`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Multi-chain DEX with concentrated liquidity protocol (KyberSwap Elastic) and a meta-aggregation router that routes across multiple DEXes for best execution. Features dynamic fees and anti-sniping protection.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kyberswap` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |

## Key Operations

- **swap**: Exact input single swap via Elastic Router (concentrated liquidity)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { KyberSwapElasticRouterABI as IElasticRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = IElasticRouter.at(routerAddress);
  return router.swapExactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    minAmountOut: amountOutMin,
    limitSqrtP: 0,
  });
}
```

- `routerAddress`: KyberSwap Elastic Router address (`0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` on every listed chain except Base, which has no Elastic deployment here)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier (similar to Uniswap V3 but with KyberSwap's own tiers)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection (named `minAmountOut` not `amountOutMinimum`)
- `recipient`: Address to receive output tokens
- `limitSqrtP`: Price limit (`0` is no limit, which leaves `amountOutMin` as the only bound; named `limitSqrtP` not `sqrtPriceLimitX96`)

## Notes

- Elastic Router naming differs from Uniswap V3: `minAmountOut` (not `amountOutMinimum`), `limitSqrtP` (not `sqrtPriceLimitX96`)
- The Elastic Router address is the same on its 6 chains, and the Meta Agg Router address on all 8
- Meta Aggregation Router routes across multiple DEXes (not just KyberSwap pools) for best execution price
- The `data` field in the Meta Agg Router swap must be pre-encoded from KyberSwap's API
- Input token must be ERC20-approved to the Elastic Router for direct swaps
- For Meta Agg swaps, approve to the `approveTarget` address returned by the API
- On Arc (5042) only the Meta Aggregation Router is deployed (no Elastic), and it is a smaller build than Ethereum's at the same address: 13724 vs 18652 bytes, a different owner, and no `swapGeneric`/whitelist functions. Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts

## Its names in a program

On Ethereum, `Kyberswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's elasticFactory, `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A`.
  require(Kyberswap.ElasticFactory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | elasticFactory | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` | `Kyberswap.ElasticFactory` |
| [Ethereum](../chains/ethereum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Ethereum](../chains/ethereum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Optimism](../chains/optimism.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Optimism](../chains/optimism.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Optimism](../chains/optimism.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [BNB Chain](../chains/bsc.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [BNB Chain](../chains/bsc.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [BNB Chain](../chains/bsc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Polygon](../chains/polygon.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Polygon](../chains/polygon.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Polygon](../chains/polygon.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Arc](../chains/arc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Base](../chains/base.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Arbitrum One](../chains/arbitrum.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Arbitrum One](../chains/arbitrum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Arbitrum One](../chains/arbitrum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Avalanche C-Chain](../chains/avalanche.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Avalanche C-Chain](../chains/avalanche.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Avalanche C-Chain](../chains/avalanche.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |

## ABI

### `KyberSwapElasticRouterABI`

`import KyberSwapElasticRouterABI from "./protocols/kyberswap/KyberSwapElasticRouterABI.json";` Speaks for: elasticRouter.

- `swapExactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP) params) payable returns (uint256 amountOut)`

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouterV2.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
