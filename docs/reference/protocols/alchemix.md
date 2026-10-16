<!-- Generated from the SDK's registries. Do not edit. -->

# Alchemix (`alchemix`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Alchemix is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Alchemix` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Deposit yield-bearing token as collateral
- **withdraw**: Withdraw collateral
- **mint**: Borrow synthetic asset (alUSD or alETH) against collateral
- **burn**: Repay synthetic asset debt

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit yield-bearing collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  amount: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.deposit(yieldToken, amount, recipient);
}

// Withdraw collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  shares: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.withdraw(yieldToken, shares, recipient);
}

// Borrow (mint) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  alchemist.mint(amount, recipient);
  return 1;
}

// Repay (burn) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.burn(amount, recipient);
}
```

## Notes

- Self-repaying: yield from deposited collateral automatically reduces debt over time
- Two Alchemist contracts: alchemistAlUSD (for USD synthetics) and alchemistAlETH (for ETH synthetics)
- Max LTV: 50% - can borrow up to half the value of deposited collateral
- yieldToken is the yield-bearing version (e.g. yvDAI, aDAI, stETH), not the base token
- Approve yieldToken to the appropriate Alchemist contract before depositing
- debt is int256 because it can be negative (overpaid/surplus)

## Its names in a program

On Ethereum, `Alchemix` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's alETH, `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6`.
  require(Alchemix.AlETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | `Alchemix.AlETH` |
| [Ethereum](../chains/ethereum.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | `Alchemix.AlUSD` |
| [Ethereum](../chains/ethereum.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `Alchemix.AlchemistAlETH` |
| [Ethereum](../chains/ethereum.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94dd` | `Alchemix.AlchemistAlUSD` |

## ABI

### `AlchemistABI`

`import AlchemistABI from "./protocols/alchemix/AlchemistABI.json";` Speaks for: alchemistAlUSD, alchemistAlETH.

- `deposit(address yieldToken, uint256 amount, address recipient) returns (uint256 shares)`
- `withdraw(address yieldToken, uint256 shares, address recipient) returns (uint256 amountWithdrawn)`
- `mint(uint256 amount, address recipient)`
- `burn(uint256 amount, address recipient) returns (uint256)`
- `liquidate(address yieldToken, uint256 shares, uint256 minimumAmountOut) returns (uint256)`
- `accounts(address owner) view returns (int256 debt, address[] depositedTokens)`
