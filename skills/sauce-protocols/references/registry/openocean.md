<!-- Generated from the SDK's registries. Do not edit. -->

# OpenOcean (`openocean`)

Cross-chain DEX aggregator providing optimal swap routing across multiple DEXes and chains.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Document | [openocean.md](../openocean.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's exchangeV2):

```sauce chain=ethereum
import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";

const EXCHANGE_V2 = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n;

function main() {
  const bound = OpenOceanExchangeV2ABI.at(EXCHANGE_V2);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [Fantom](../../../sauce-chains/references/fantom.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |

## ABI

### `OpenOceanExchangeV2ABI`

`import OpenOceanExchangeV2ABI from "./protocols/openocean/OpenOceanExchangeV2ABI.json";` Speaks for: exchangeV2.

- `swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)`
