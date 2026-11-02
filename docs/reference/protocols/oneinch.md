<!-- Generated from the SDK's registries. Do not edit. -->

# 1inch (`oneinch`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> 1inch is an exchange aggregator: it routes a swap across many exchanges. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

DEX aggregator that routes swaps across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Oneinch` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## When to use it

- An aggregator: its router fills a swap across many venues along a route its off-chain API
  quotes. Use it for a route the program does not want to choose itself.

## Pitfalls for a program

- The calldata is quoted for one sender, amount and moment: quote it for the Pot (the swap's
  sender) and send it soon.
- Approve the router for exactly `amountIn`, and clear the allowance after.
- The calldata's own minimum is not yours: check the output as a balance delta against your
  `minOut`.

## In a Sauce program

Forward a 1inch quote for the Pot, checked by the WETH received:

```ts
function main(amountIn: Uint256, minOut: Uint256, call: bytes, recipient: Address) {
  const before = WETH.balanceOf(pot);
  USDC.approve(Oneinch.AggregationRouterV6, amountIn);
  evm.call(Oneinch.AggregationRouterV6, 0, call);
  const out = WETH.balanceOf(pot) - before;
  require(out >= minOut, "below minOut");
  USDC.approve(Oneinch.AggregationRouterV6, 0);
  WETH.transfer(recipient, out);
}
```

## What it offers

- **unoswap**: Single-source optimized swap via AggregationRouter
- **swap**: Multi-source aggregated swap with custom routing

## Notes

- Same contract address across all 7 chains
- V6 router is the latest version
- unoswap is gas-efficient for single-pool swaps; swap handles complex multi-hop routes
- `dex` in unoswap packs the pool address with its protocol and swap-direction flags in the high bits
- Fusion mode enables gasless swaps via order matching (off-chain, not in ABI)
- Approve srcToken to aggregationRouterV6 before swapping

## Its names in a program

On Ethereum, `Oneinch` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's aggregationRouterV6, `0x111111125421cA6dc452d289314280a0f8842A65`.
  require(Oneinch.AggregationRouterV6 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Optimism](../chains/optimism.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [BNB Chain](../chains/bsc.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Polygon](../chains/polygon.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Base](../chains/base.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Arbitrum One](../chains/arbitrum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Avalanche C-Chain](../chains/avalanche.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |

## ABI

### `AggregationRouterV6ABI`

`import AggregationRouterV6ABI from "./protocols/oneinch/AggregationRouterV6ABI.json";` Speaks for: aggregationRouterV6. The import is the contract's full ABI across every deployment; call it through the `Oneinch` namespace to have a function a chain's deployment does not run refused.

- `advanceEpoch(uint96 series, uint256 amount)`
- `and(uint256 offsets, bytes data) view returns (bool)`
- `arbitraryStaticCall(address target, bytes data) view returns (uint256)`
- `bitInvalidatorForOrder(address maker, uint256 slot) view returns (uint256)`
- `bitsInvalidateForOrder(uint256 makerTraits, uint256 additionalMask)`
- `cancelOrder(uint256 makerTraits, bytes32 orderHash)`
- `cancelOrders(uint256[] makerTraits, bytes32[] orderHashes)`
- `checkPredicate(bytes predicate) view returns (bool)`
- `clipperSwap(address clipperExchange, uint256 srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)`
- `clipperSwapTo(address clipperExchange, address recipient, uint256 srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)`
- `curveSwapCallback(address, address, address inCoin, uint256 dx, uint256)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `epoch(address maker, uint96 series) view returns (uint256)`
- `epochEquals(address maker, uint256 series, uint256 makerEpoch) view returns (bool)`
- `eq(uint256 value, bytes data) view returns (bool)`
- `ethUnoswap(uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)`
- `ethUnoswap2(uint256 minReturn, uint256 dex, uint256 dex2) payable returns (uint256 returnAmount)`
- `ethUnoswap3(uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) payable returns (uint256 returnAmount)`
- `ethUnoswapTo(uint256 to, uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)`
- `ethUnoswapTo2(uint256 to, uint256 minReturn, uint256 dex, uint256 dex2) payable returns (uint256 returnAmount)`
- `ethUnoswapTo3(uint256 to, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) payable returns (uint256 returnAmount)`
- `fillContractOrder((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes signature, uint256 amount, uint256 takerTraits) returns (uint256, uint256, bytes32)`
- `fillContractOrderArgs((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes signature, uint256 amount, uint256 takerTraits, bytes args) returns (uint256, uint256, bytes32)`
- `fillOrder((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 r, bytes32 vs, uint256 amount, uint256 takerTraits) payable returns (uint256, uint256, bytes32)`
- `fillOrderArgs((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 r, bytes32 vs, uint256 amount, uint256 takerTraits, bytes args) payable returns (uint256, uint256, bytes32)`
- `gt(uint256 value, bytes data) view returns (bool)`
- `hashOrder((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order) view returns (bytes32)`
- `increaseEpoch(uint96 series)`
- `lt(uint256 value, bytes data) view returns (bool)`
- `not(bytes data) view returns (bool)`
- `or(uint256 offsets, bytes data) view returns (bool)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `permitAndCall(bytes permit, bytes action) payable`
- `rawRemainingInvalidatorForOrder(address maker, bytes32 orderHash) view returns (uint256)`
- `remainingInvalidatorForOrder(address maker, bytes32 orderHash) view returns (uint256)`
- `renounceOwnership()`
- `rescueFunds(address token, uint256 amount)`
- `simulate(address target, bytes data)`
- `swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)`
- `transferOwnership(address newOwner)`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes)`
- `unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)`
- `unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2) returns (uint256 returnAmount)`
- `unoswap3(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) returns (uint256 returnAmount)`
- `unoswapTo(uint256 to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)`
- `unoswapTo2(uint256 to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2) returns (uint256 returnAmount)`
- `unoswapTo3(uint256 to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) returns (uint256 returnAmount)`
- `unpause()`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
