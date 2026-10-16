<!-- Generated from the SDK's registries. Do not edit. -->

# Beefy Finance (`beefy`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Beefy Finance is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Beefy` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Key Operations

- **deposit**: Deposit want tokens into Beefy vault
- **depositAll**: Deposit entire balance of want token
- **withdraw**: Withdraw by specifying share amount
- **withdrawAll**: Withdraw entire position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Beefy vault
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}

// Deposit entire balance
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.depositAll();
  return 1;
}

// Withdraw shares
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdraw(shares);
  return 1;
}

// Withdraw all
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdrawAll();
  return 1;
}
```

## Notes

- TVL: $300M+. Each vault has a unique address per strategy
- Approve want token to vault before depositing
- Use want() to discover which token a vault accepts
- getPricePerFullShare() returns the exchange rate between shares and want tokens
- Auto-compounds rewards - no manual claiming needed

## Its names in a program

On Ethereum, `Beefy` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's BIFI, `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1`.
  require(Beefy.BIFI != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | BIFI | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` | `Beefy.BIFI` |
| [Optimism](../chains/optimism.md) | BIFI | `0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642` | `Beefy.BIFI` |
| [BNB Chain](../chains/bsc.md) | BIFI | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` | `Beefy.BIFI` |
| [Polygon](../chains/polygon.md) | BIFI | `0xFbdd194376de19a88F4A68671C339563c427310d` | `Beefy.BIFI` |
| [Base](../chains/base.md) | BIFI | `0xc55E93C62874D8100dBd2DfE307EDc1036ad5434` | `Beefy.BIFI` |
| [Arbitrum One](../chains/arbitrum.md) | BIFI | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` | `Beefy.BIFI` |
| [Avalanche C-Chain](../chains/avalanche.md) | BIFI | `0xd6070ae98b8069de6B494332d1A1a81B6179D960` | `Beefy.BIFI` |

## ABI

### `BeefyVaultABI`

`import BeefyVaultABI from "./protocols/beefy/BeefyVaultABI.json";`

- `deposit(uint256 _amount)`
- `depositAll()`
- `withdraw(uint256 _shares)`
- `withdrawAll()`
- `getPricePerFullShare() view returns (uint256)`
- `balance() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `want() view returns (address)`
