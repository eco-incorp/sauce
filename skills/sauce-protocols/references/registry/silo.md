<!-- Generated from the SDK's registries. Do not edit. -->

# Silo (`silo`)

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arbitrum |
| Document | [silo.md](../silo.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's siloRepository):

```sauce chain=ethereum
import SiloRepositoryABI from "./protocols/silo/SiloRepositoryABI.json";

const SILO_REPOSITORY = 0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49n;

function main() {
  const bound = SiloRepositoryABI.at(SILO_REPOSITORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `SiloRepositoryABI.at(0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `SiloRepositoryABI.at(0x8658047e48CC09161f4152c79155Dac1d710Ff0an)` |

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
