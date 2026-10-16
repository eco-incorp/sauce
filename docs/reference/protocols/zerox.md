<!-- Generated from the SDK's registries. Do not edit. -->

# 0x Protocol (`zerox`)

> 0x Protocol is an exchange aggregator: it looks across many exchanges for the best price. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Zerox` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Key Operations

- **transformERC20**: Execute a token swap via the Exchange Proxy transformer pipeline

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Note: 0x requires off-chain route computation via 0x API before on-chain execution.
// The transformERC20 function uses transformations array populated from API response.
```

## Notes

- Same Exchange Proxy address across all 7 chains
- Uses transformer pipeline architecture - each swap is a sequence of transformations
- Route computation happens via 0x API - transformations array comes from API response
- Approve inputToken to exchangeProxy before swapping
- 0x API provides the optimal route, slippage protection, and transformer calldata

## Its names in a program

On Ethereum, `Zerox` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's exchangeProxy, `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`.
  require(Zerox.ExchangeProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Optimism](../chains/optimism.md) | exchangeProxy | `0xDEF1ABE32c034e558Cdd535791643C58a13aCC10` | `Zerox.ExchangeProxy` |
| [BNB Chain](../chains/bsc.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Polygon](../chains/polygon.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Base](../chains/base.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Arbitrum One](../chains/arbitrum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Avalanche C-Chain](../chains/avalanche.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## ABI

### `ExchangeProxyABI`

`import ExchangeProxyABI from "./protocols/zerox/ExchangeProxyABI.json";` Speaks for: exchangeProxy.

- `transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations) payable returns (uint256 outputTokenAmount)`
