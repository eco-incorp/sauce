# Euler V2

Modular lending platform built on the Ethereum Vault Connector (EVC). Supports permissionless vault creation with customizable risk parameters.

## Category

lending | Chains and addresses: [registry/euler-v2.md](registry/euler-v2.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

- `owner`: Address whose shares are burned (the caller, which in a Sauce program is the Pot, or one that gave the Pot an allowance)
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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/euler-v2.md](registry/euler-v2.md).

## Notes

- ERC-4626 compatible vault interface (deposit/withdraw/redeem)
- Must call `EVC.enableCollateral(account, collateralVault)` AND `EVC.enableController(account, borrowVault)` before borrowing
- Each EVault is a separate market with its own underlying asset and risk parameters
- Vaults are permissionlessly created -- always verify vault parameters before depositing
- Rebuilt from scratch after V1 exploit -- new architecture based on EVC
- TVL: $1B+. Audited
