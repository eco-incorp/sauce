# KyberSwap

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Multi-chain DEX with concentrated liquidity protocol (KyberSwap Elastic) and a meta-aggregation router that routes across multiple DEXes for best execution. Features dynamic fees and anti-sniping protection.

## Category

dex | Chains and addresses: [registry/kyberswap.md](registry/kyberswap.md)

## Key Operations

- **swap**: Exact input single swap via Elastic Router (concentrated liquidity)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/kyberswap.md](registry/kyberswap.md).

## Notes

- Elastic Router naming differs from Uniswap V3: `minAmountOut` (not `amountOutMinimum`), `limitSqrtP` (not `sqrtPriceLimitX96`)
- The Elastic Router address is the same on its 6 chains, and the Meta Agg Router address on all 8
- Meta Aggregation Router routes across multiple DEXes (not just KyberSwap pools) for best execution price
- The `data` field in the Meta Agg Router swap must be pre-encoded from KyberSwap's API
- Input token must be ERC20-approved to the Elastic Router for direct swaps
- For Meta Agg swaps, approve to the `approveTarget` address returned by the API
- On Arc (5042) only the Meta Aggregation Router is deployed (no Elastic), and it is a smaller build than Ethereum's at the same address: 13724 vs 18652 bytes, a different owner, and no `swapGeneric`/whitelist functions. Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts
