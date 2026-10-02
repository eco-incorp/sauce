<!-- Generated from the SDK's registries. Do not edit. -->

# Euler V2 (`euler-v2`)

Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Euler`: `euler-v2` |
| Namespace | `EulerV2` on ethereum |
| Chains | ethereum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### deposit

Deposit assets into an EVault. Returns shares representing the deposit.

```typescript
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.deposit(amount, receiver);
}
```

- `vaultAddress`: Specific EVault address (each vault has its own asset and risk params)
- `receiver`: Address that receives the vault shares
- Returns the number of shares minted
- Requires ERC-20 approval of the underlying asset to the vault

### withdraw

Withdraw assets from an EVault by specifying underlying amount.

```typescript
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.withdraw(amount, receiver, owner);
}
```

- `owner`: Address whose shares are burned (must be msg.sender or have allowance)
- Returns the number of shares burned

### borrow

Borrow assets from an EVault. Must have collateral enabled via EVC first.

```typescript
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.borrow(amount, receiver);
}
```

- Must enable collateral and controller on EVC before borrowing
- Returns the number of debt shares created

### repay

Repay borrowed assets to reduce debt.

```typescript
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.repay(amount, receiver);
}
```

- `receiver`: Address whose debt is being repaid
- Requires ERC-20 approval of the underlying to the vault
- Returns the number of debt shares burned

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
  require(EulerV2.EthereumVaultConnector != 0n);
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
