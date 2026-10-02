<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Frax` on ethereum |
| Chains | ethereum |

## Key Operations

- **transfer**: Transfer FRAX tokens
- **approve**: Approve FRAX token spender

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Transfer FRAX
import { transfer } from "@sauce/token";
function main(fraxAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(fraxAddress, to, amount);
  return 1;
}

// Approve FRAX spender
import { approve } from "@sauce/token";
function main(fraxAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(fraxAddress, spender, amount);
  return 1;
}
```

## Notes

- TVL: $1B+. V1 was fractional-algorithmic, V2 (Frax v3) is fully collateralized
- FXS is the governance/value accrual token
- sFRAX is the staked FRAX vault (ERC-4626) for earning yield - see frax-ether module for sfrxETH
- Frax ecosystem includes: FRAX (stablecoin), frxETH/sfrxETH (liquid staking), FPI (inflation-pegged)

## Its names in a program

On Ethereum, `Frax` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's frax, `0x853d955aCEf822Db058eb8505911ED77F175b99e`.
  require(Frax.Frax != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`
