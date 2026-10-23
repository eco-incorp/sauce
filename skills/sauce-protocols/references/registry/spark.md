<!-- Generated from the SDK's registries. Do not edit. -->

# Spark (`spark`)

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers DAI/USDS borrowing backed by the Maker protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Spark` on ethereum |
| Chains | ethereum |
| Document | [spark.md](../spark.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Spark` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's pool, `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`.
  require(Spark.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |

## ABI

### `SparkPoolABI`

`import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
