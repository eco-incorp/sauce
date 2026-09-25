# KyberSwap

Multi-chain DEX with concentrated liquidity protocol (KyberSwap Elastic) and a meta-aggregation router that routes across multiple DEXes for best execution. Features dynamic fees and anti-sniping protection.

## Category

dex | Chains: Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, Base

## Key Operations

- **swap**: Exact input single swap via Elastic Router (concentrated liquidity)

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/kyberswap";
```

## SauceScript Examples

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

- `routerAddress`: KyberSwap Elastic Router address (same on most chains: `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier (similar to Uniswap V3 but with KyberSwap's own tiers)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection (named `minAmountOut` not `amountOutMinimum`)
- `recipient`: Address to receive output tokens
- `limitSqrtP`: Price limit (set to `0` for no limit; named `limitSqrtP` not `sqrtPriceLimitX96`)

## Key Addresses

| Chain     | Contract           | Address                                      |
| --------- | ------------------ | -------------------------------------------- |
| Ethereum  | Elastic Factory    | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` |
| Ethereum  | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Ethereum  | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Arbitrum  | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| Arbitrum  | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Arbitrum  | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Optimism  | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| Optimism  | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Optimism  | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Polygon   | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| Polygon   | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Polygon   | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| BSC       | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| BSC       | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| BSC       | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Avalanche | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| Avalanche | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Avalanche | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Base      | Elastic Factory    | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` |
| Base      | Elastic Router     | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` |
| Base      | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |

## ABI Methods

### KyberSwapElasticRouterABI

- `swapExactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP)) -> uint256 amountOut` - Single-hop exact input swap via Elastic pools

### KyberSwapMetaAggregationRouterABI

- `swap(tuple(address callTo, address approveTarget, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient, bytes data)) -> (uint256 returnAmount, uint256 gasUsed)` - Execute a swap via the meta-aggregation router (routes across multiple DEXes for best price)

## Notes

- Elastic Router naming differs from Uniswap V3: `minAmountOut` (not `amountOutMinimum`), `limitSqrtP` (not `sqrtPriceLimitX96`)
- Elastic Router and Meta Agg Router addresses are consistent across all 7 chains
- Meta Aggregation Router routes across multiple DEXes (not just KyberSwap pools) for best execution price
- The `data` field in the Meta Agg Router swap must be pre-encoded from KyberSwap's API
- Input token must be ERC20-approved to the Elastic Router for direct swaps
- For Meta Agg swaps, approve to the `approveTarget` address returned by the API
