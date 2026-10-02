<!-- Generated from the SDK's registries. Do not edit. -->

# 0x Protocol (`zerox`)

DEX aggregation protocol powering swaps across the DeFi ecosystem. Exchange Proxy provides a single entry point for token swaps across multiple sources.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Zerox` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [zerox.md](../zerox.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Zerox` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's exchangeProxy, `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`.
  require(Zerox.ExchangeProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Optimism](../../../sauce-chains/references/optimism.md) | exchangeProxy | `0xDEF1ABE32c034e558Cdd535791643C58a13aCC10` | `Zerox.ExchangeProxy` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Polygon](../../../sauce-chains/references/polygon.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Base](../../../sauce-chains/references/base.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## ABI

### `ExchangeProxyABI`

`import ExchangeProxyABI from "./protocols/zerox/ExchangeProxyABI.json";` Speaks for: exchangeProxy.

- `transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations) payable returns (uint256 outputTokenAmount)`
