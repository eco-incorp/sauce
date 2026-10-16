<!-- Generated from the SDK's registries. Do not edit. -->

# Harvest Finance (`harvest`)

> Harvest Finance is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Harvest` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit tokens into Harvest vault
- **withdraw**: Withdraw tokens from vault
- **getPricePerFullShare**: Query vault share price

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Harvest vault
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}
```

## Notes

- FARM token for governance. Auto-compounds strategy rewards.

## Its names in a program

On Ethereum, `Harvest` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's controller, `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C`.
  require(Harvest.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` | `Harvest.Controller` |
| [Ethereum](../chains/ethereum.md) | depositHelper | `0xF8ce90c2710713552fb564869694B2505Bfc0846` | `Harvest.DepositHelper` |
| [Ethereum](../chains/ethereum.md) | farm | `0xa0246c9032bC3A600820415aE600c6388619A14D` | `Harvest.Farm` |

## ABI

### `VaultABI`

`import VaultABI from "./protocols/harvest/VaultABI.json";`

- `deposit(uint256 amount) returns (uint256)`
- `withdraw(uint256 numberOfShares) returns (uint256)`
- `getPricePerFullShare() view returns (uint256)`
- `underlyingBalanceWithInvestment() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
