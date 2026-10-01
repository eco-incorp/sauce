<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [paraswap.md](../paraswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's augustusV5):

```sauce chain=ethereum
import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";

const AUGUSTUS_V5 = 0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n;

function main() {
  const bound = AugustusV5ABI.at(AUGUSTUS_V5);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Base](../../../sauce-chains/references/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Base](../../../sauce-chains/references/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |

## ABI

### `AugustusV5ABI`

`import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";` Speaks for: augustusV5.

- `simpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`
