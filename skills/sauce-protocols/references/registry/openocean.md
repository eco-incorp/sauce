<!-- Generated from the SDK's registries. Do not edit. -->

# OpenOcean (`openocean`)

Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.

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
  require(Openocean.ExchangeV2 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Fantom](../../../sauce-chains/references/fantom.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |

## ABI

### `OpenOceanExchangeV2ABI`

`import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";` Speaks for: exchangeV2.

- `swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
