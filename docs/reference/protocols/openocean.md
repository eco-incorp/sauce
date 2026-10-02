<!-- Generated from the SDK's registries. Do not edit. -->

# OpenOcean (`openocean`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Openocean` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |

## Key Operations

- **swap**: Execute aggregated swap via OpenOcean Exchange

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Swap via OpenOcean
import { OpenOceanExchangeV2ABI as IOpenOceanExchange } from "./abis";
function main(
  exchangeAddress: Address,
  caller: Address,
  srcToken: Address,
  dstToken: Address,
  srcReceiver: Address,
  dstReceiver: Address,
  amount: Uint256,
  minReturnAmount: Uint256,
  guaranteedAmount: Uint256,
  referrer: Address,
  calls: { target: Uint256; gasLimit: Uint256; value: Uint256; data: bytes }[],
): Uint256 {
  const exchange = IOpenOceanExchange.at(exchangeAddress);
  return exchange.swap(
    caller,
    {
      srcToken: srcToken,
      dstToken: dstToken,
      srcReceiver: srcReceiver,
      dstReceiver: dstReceiver,
      amount: amount,
      minReturnAmount: minReturnAmount,
      guaranteedAmount: guaranteedAmount,
      flags: 0,
      referrer: referrer,
      permit: 0x00,
    },
    calls,
  );
}
```

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
  require(Openocean.ExchangeV2 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism](../chains/optimism.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [BNB Chain](../chains/bsc.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Polygon](../chains/polygon.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Fantom](../chains/fantom.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Arbitrum One](../chains/arbitrum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Avalanche C-Chain](../chains/avalanche.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |

## ABI

### `OpenOceanExchangeV2ABI`

`import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";` Speaks for: exchangeV2.

- `swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
