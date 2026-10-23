<!-- Generated from the SDK's registries. Do not edit. -->

# Silo (`silo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Silo is a lending market: deposit tokens to earn interest, or borrow against them. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Silo` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Notes

- Each Silo is an isolated two-asset market -- risk from one market cannot spread to others
- `collateralOnly = true` gives higher LTV but your deposit cannot be lent out to borrowers
- Use `SiloRepository.getSilo(assetAddress)` to find the Silo contract for any asset
- Same SiloRepository address on Ethereum and Arbitrum
- All deposit/repay operations require ERC-20 approval
- TVL: $200M+. Audited

## Its names in a program

On Ethereum, `Silo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's siloRepository, `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49`.
  require(Silo.SiloRepository != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `Silo.SiloRepository` |
| [Arbitrum One](../chains/arbitrum.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `Silo.SiloRepository` |

## ABI

### `SiloABI`

`import SiloABI from "./protocols/silo/SiloABI.json";`

- `deposit(address asset, uint256 amount, bool collateralOnly) returns (uint256 collateralAmount, uint256 collateralShare)`
- `withdraw(address asset, uint256 amount, bool collateralOnly) returns (uint256 withdrawnAmount, uint256 withdrawnShare)`
- `borrow(address asset, uint256 amount) returns (uint256 debtAmount, uint256 debtShare)`
- `repay(address asset, uint256 amount) returns (uint256 repaidAmount, uint256 repaidShare)`

### `SiloRepositoryABI`

`import SiloRepositoryABI from "./protocols/silo/SiloRepositoryABI.json";` Speaks for: siloRepository.

- `getSilo(address asset) view returns (address silo)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
