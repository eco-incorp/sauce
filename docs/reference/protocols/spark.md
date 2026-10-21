<!-- Generated from the SDK's registries. Do not edit. -->

# Spark (`spark`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Spark is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers competitive rates on DAI/USDS borrowing backed by the Maker protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Spark` on ethereum |
| Chains | ethereum |

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- Competitive DAI/USDS borrow rates subsidized by MakerDAO/Sky
- interestRateMode: 2 = variable (stable rate being phased out)
- All supply/repay operations require ERC-20 approval to the Pool
- Ethereum-only deployment. TVL: $5B+. Audited

## Its names in a program

On Ethereum, `Spark` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's pool, `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`.
  require(Spark.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Ethereum](../chains/ethereum.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |

## ABI

### `SparkPoolABI`

`import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
