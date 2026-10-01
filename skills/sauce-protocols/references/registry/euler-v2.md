<!-- Generated from the SDK's registries. Do not edit. -->

# Euler V2 (`euler-v2`)

Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [euler-v2.md](../euler-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's ethereumVaultConnector):

```sauce chain=ethereum
import EVCABI from "./protocols/euler-v2/EVCABI.json";

const ETHEREUM_VAULT_CONNECTOR = 0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383n;

function main() {
  const bound = EVCABI.at(ETHEREUM_VAULT_CONNECTOR);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethereumVaultConnector | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` | `EVCABI.at(0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383n)` |

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
