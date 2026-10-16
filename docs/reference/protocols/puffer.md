<!-- Generated from the SDK's registries. Do not edit. -->

# Puffer Finance (`puffer`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Puffer Finance is a restaking protocol: staked coins put to work securing other services too. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Liquid restaking protocol that issues pufETH via an ERC-4626 vault. Deposits are natively restaked via EigenLayer for additional yield.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Puffer` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit assets into PufferVault, receive pufETH shares
- **redeem**: Redeem pufETH shares for underlying assets

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into PufferVault
import { PufferVaultABI as IPufferVault } from "./abis";
function main(pufferVaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.deposit(assets, receiver);
}

// Redeem pufETH shares
import { PufferVaultABI as IPufferVault } from "./abis";
function main(
  pufferVaultAddress: Address,
  shares: Uint256,
  receiver: Address,
  owner: Address,
): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Notes

- TVL: $62M+. ERC-4626 vault interface (same as Yearn V3, sfrxETH, sDAI)
- pufETH is non-rebasing - exchange rate increases over time
- Natively restaked on EigenLayer
- Standard ERC-4626 deposit/redeem pattern

## Its names in a program

On Ethereum, `Puffer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's pufETH, `0xD9A442856C234a39a81a089C06451EBAa4306a72`.
  require(Puffer.PufETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Ethereum](../chains/ethereum.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |

## ABI

### `PufferVaultABI`

`import PufferVaultABI from "./protocols/puffer/PufferVaultABI.json";` Speaks for: pufferVault.

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
