<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V2 (`aave-v2`)

Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV2` on ethereum, polygon, avalanche |
| Chains | ethereum, polygon, avalanche |
| Document | [aave-v2.md](../aave-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `AaveV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's lendingPool, `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Polygon](../../../sauce-chains/references/polygon.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool` |

## ABI

### `LendingPoolABI`

`import LendingPoolABI from "./protocols/aave-v2/LendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
