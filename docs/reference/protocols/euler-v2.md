<!-- Generated from the SDK's registries. Do not edit. -->

# Euler V2 (`euler-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Euler V2 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Euler`: `euler-v2` |
| Namespace | `EulerV2` on ethereum |
| Chains | ethereum |

## Notes

- ERC-4626 compatible vault interface (deposit/withdraw/redeem)
- Must call `EVC.enableCollateral(account, collateralVault)` AND `EVC.enableController(account, borrowVault)` before borrowing
- Each EVault is a separate market with its own underlying asset and risk parameters
- Vaults are permissionlessly created -- always verify vault parameters before depositing
- Rebuilt from scratch after V1 exploit -- new architecture based on EVC
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `EulerV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ethereumVaultConnector, `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383`.
  require(EulerV2.EthereumVaultConnector != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ethereumVaultConnector | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` | `EulerV2.EthereumVaultConnector` |

## ABI

### `EVCABI`

`import EVCABI from "./protocols/euler-v2/EVCABI.json";` Speaks for: ethereumVaultConnector.

- `enableCollateral(address account, address vault) payable`
- `enableController(address account, address vault) payable`

### `EVaultABI`

`import EVaultABI from "./protocols/euler-v2/EVaultABI.json";`

- `deposit(uint256 amount, address receiver) returns (uint256 shares)`
- `withdraw(uint256 amount, address receiver, address owner) returns (uint256 shares)`
- `borrow(uint256 amount, address receiver) returns (uint256 shares)`
- `repay(uint256 amount, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 amount)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
