<!-- Generated from the SDK's registries. Do not edit. -->

# Spark (`spark`)

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers competitive rates on DAI/USDS borrowing backed by the Maker protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [spark.md](../spark.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's pool):

```sauce chain=ethereum
import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";

const POOL = 0xC13e21B648A5Ee794902342038FF3aDAB66BE987n;

function main() {
  const bound = SparkPoolABI.at(POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `SparkPoolABI.at(0xC13e21B648A5Ee794902342038FF3aDAB66BE987n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | no registry ABI |

## ABI

### `SparkPoolABI`

`import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
