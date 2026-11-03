<!-- Generated from the SDK's registries. Do not edit. -->

# OpenOcean (`openocean`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> OpenOcean is an exchange aggregator: it routes a swap across many exchanges. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Cross-chain DEX aggregator routing swaps across multiple DEXes and chains.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Openocean` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |

## What it offers

- **swap**: Execute aggregated swap via OpenOcean Exchange

## Notes

- TVL: $200M+. Same contract address across all 7 supported chains
- Route computation via OpenOcean API - calls parameter comes from API response
- Approve srcToken to exchangeV2 before swapping
- caller is typically msg.sender; srcReceiver receives tokens from the caller

## Its names in a program

On Ethereum, `Openocean` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's exchangeV2, `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`.
  require(Openocean.ExchangeV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism](../chains/optimism.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [BNB Chain](../chains/bsc.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Polygon](../chains/polygon.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Fantom](../chains/fantom.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `permit2`, `permit2DomainSeperator`, `permit2NextNonce`, `permit2NextNonceAfter`, `setPermit2`, `simpleSwap`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Arbitrum One](../chains/arbitrum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Avalanche C-Chain](../chains/avalanche.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |

## ABI

### `OpenOceanExchangeV2ABI`

`import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";` Speaks for: exchangeV2. The import is the contract's full ABI across every deployment; call it through the `Openocean` namespace to have a function a chain's deployment does not run refused.

- `callUniswap(address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools) payable returns (uint256 returnAmount)`
- `callUniswapTo(address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools, address recipient) payable returns (uint256 returnAmount)`
- `callUniswapToWithPermit(address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools, bytes permit, address recipient) returns (uint256 returnAmount)`
- `callUniswapWithPermit(address srcToken, uint256 amount, uint256 minReturn, bytes32[] pools, bytes permit) returns (uint256 returnAmount)`
- `initialize()`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `permit2() view returns (address)`
- `permit2DomainSeperator() view returns (bytes32)`
- `permit2NextNonce(address owner) view returns (uint256 nonce)`
- `permit2NextNonceAfter(address owner, uint256 start) view returns (uint256 nonce)`
- `renounceOwnership()`
- `rescueFunds(address token, uint256 amount)`
- `setPermit2(address _permit2)`
- `simpleSwap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
- `swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
- `swapGmxV2(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
- `transferOwnership(address newOwner)`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes)`
- `uniswapV3SwapTo(address recipient, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)`
- `uniswapV3SwapToWithPermit(address recipient, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit, address srcToken) returns (uint256 returnAmount)`

Not on BNB Chain's exchangeV2 (`0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`), whose code does not dispatch them or declares them otherwise: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's exchangeV2 (`0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`), whose code does not dispatch them or declares them otherwise: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Fantom's exchangeV2 (`0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`), whose code does not dispatch them or declares them otherwise: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `permit2`, `permit2DomainSeperator`, `permit2NextNonce`, `permit2NextNonceAfter`, `setPermit2`, `simpleSwap`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit`. Do not call them there: a program compiled for Fantom is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's exchangeV2 (`0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`), whose code does not dispatch them or declares them otherwise: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `event Unpaused` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
