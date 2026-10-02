<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Paraswap` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Key Operations

- **simpleSwap**: Execute a simple single-path swap via Augustus router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Note: ParaSwap requires off-chain route computation via API before on-chain execution.
// The simpleSwap function uses complex tuple params populated from API response.
```

## Notes

- Augustus V5 and V6 both deployed on all chains
- Delta algorithm protects against MEV/sandwich attacks
- Route computation happens off-chain via ParaSwap API - callees/exchangeData come from API
- Approve srcToken to Augustus contract before swapping
- V6 is newer but V5 is more widely integrated

## Its names in a program

On Ethereum, `Paraswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's augustusV5, `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`.
  require(Paraswap.AugustusV5 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Ethereum](../chains/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Optimism](../chains/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Optimism](../chains/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [BNB Chain](../chains/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [BNB Chain](../chains/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Polygon](../chains/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Polygon](../chains/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Base](../chains/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Base](../chains/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Arbitrum One](../chains/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Arbitrum One](../chains/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Avalanche C-Chain](../chains/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Avalanche C-Chain](../chains/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |

## ABI

### `AugustusV5ABI`

`import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";` Speaks for: augustusV5.

- `simpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`
