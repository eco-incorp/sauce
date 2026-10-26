<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Paraswap` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [paraswap.md](../paraswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Paraswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's augustusV5, `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`.
  require(Paraswap.AugustusV5 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Base](../../../sauce-chains/references/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `simpleSwap` |
| [Base](../../../sauce-chains/references/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |

## ABI

### `AugustusV5ABI`

`import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";` Speaks for: augustusV5.

- `simpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`

Not on Base's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them: `simpleSwap`. A call to one reverts there.
