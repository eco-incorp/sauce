<!-- Generated from the SDK's registries. Do not edit. -->

# 1inch (`oneinch`)

DEX aggregator that routes swaps across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Oneinch` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [oneinch.md](../oneinch.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Oneinch` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's aggregationRouterV6, `0x111111125421cA6dc452d289314280a0f8842A65`.
  require(Oneinch.AggregationRouterV6 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Optimism](../../../sauce-chains/references/optimism.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Polygon](../../../sauce-chains/references/polygon.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Base](../../../sauce-chains/references/base.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |

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
