# KyberSwap

Multi-chain DEX with concentrated liquidity protocol (KyberSwap Elastic) and a meta-aggregation router that routes across multiple DEXes for best execution. Features dynamic fees and anti-sniping protection.

## Category

dex | Chains: Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, Base, Arc

## Key Operations

- **swap**: Exact input single swap via Elastic Router (concentrated liquidity)

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/kyberswap";
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

- `routerAddress`: KyberSwap Elastic Router address (`0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` on every listed chain except Base, which has no Elastic deployment here)
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
| Base      | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| Arc       | Meta Agg Router V2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |

## ABI Methods

### KyberSwapElasticRouterABI

- `swapExactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP)) -> uint256 amountOut` - Single-hop exact input swap via Elastic pools

### KyberSwapMetaAggregationRouterABI

- `swap(tuple(address callTarget, address approveTarget, bytes targetData, tuple(address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData)) -> (uint256 returnAmount, uint256 gasUsed)` - Execute a swap via the meta-aggregation router (routes across multiple DEXes for best price). The execution struct comes from the KyberSwap API

## Notes

- Elastic Router naming differs from Uniswap V3: `minAmountOut` (not `amountOutMinimum`), `limitSqrtP` (not `sqrtPriceLimitX96`)
- The Elastic Router address is the same on its 6 chains, and the Meta Agg Router address on all 8
- Meta Aggregation Router routes across multiple DEXes (not just KyberSwap pools) for best execution price
- The `data` field in the Meta Agg Router swap must be pre-encoded from KyberSwap's API
- Input token must be ERC20-approved to the Elastic Router for direct swaps
- For Meta Agg swaps, approve to the `approveTarget` address returned by the API
- On Arc (5042) only the Meta Aggregation Router is deployed (no Elastic), and it is a smaller build than Ethereum's at the same address: 13724 vs 18652 bytes, a different owner, and no `swapGeneric`/whitelist functions. Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts
