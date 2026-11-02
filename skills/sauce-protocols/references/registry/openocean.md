<!-- Generated from the SDK's registries. Do not edit. -->

# OpenOcean (`openocean`)

Cross-chain DEX aggregator routing swaps across multiple DEXes and chains.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Openocean` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Document | [openocean.md](../openocean.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Openocean` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's exchangeV2, `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`.
  require(Openocean.ExchangeV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Polygon](../../../sauce-chains/references/polygon.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Fantom](../../../sauce-chains/references/fantom.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `permit2`, `permit2DomainSeperator`, `permit2NextNonce`, `permit2NextNonceAfter`, `setPermit2`, `simpleSwap`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |

## ABI

### `OpenOceanExchangeV2ABI`

`import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";` Speaks for: exchangeV2.

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
