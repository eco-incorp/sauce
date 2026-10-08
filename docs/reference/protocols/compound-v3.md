<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V3 (`compound-v3`)

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV3` on ethereum, optimism, polygon, base, arbitrum, scroll |
| Chains | ethereum, optimism, polygon, base, arbitrum, scroll |

## When to use it

- Each market (a Comet) has one base asset you can supply for interest or borrow, and a list of
  collateral assets you supply to borrow it. The namespace names each Comet by its base asset
  (`CUSDCv3`, `CWETHv3`).
- Choose it when you only need to borrow the base asset; for several borrowable assets against
  shared collateral, Aave V3.

## Pitfalls for a program

- Approve the Comet before `supply`.
- `supply(asset, amount)` credits its caller, the Pot: the position is then the Pot's, not the
  user's wallet's. `supplyTo(dst, asset, amount)` credits `dst`; ask the user which they want.
- Supplying the base asset while you have a borrow repays the borrow first.
- Withdrawing more base asset than you supplied **borrows** the rest, if your collateral allows:
  check `balanceOf` and `borrowBalanceOf` before and after.
- Collateral earns no interest, and each collateral asset has a supply cap.
- `balanceOf` is the base supply with interest: it grows on its own.

## In a Sauce program

Supply the Pot's USDC to the USDC market for `onBehalfOf` (the user's wallet, or `ctx.self()` to
keep the position in the Pot) and check it was credited:

```ts
function main(onBehalfOf: Address, amount: Uint256) {
  const before = CompoundV3.CUSDCv3.balanceOf(onBehalfOf);
  USDC.approve(CompoundV3.CUSDCv3, amount);
  CompoundV3.CUSDCv3.supplyTo(onBehalfOf, USDC, amount);
  require(CompoundV3.CUSDCv3.balanceOf(onBehalfOf) > before, "supply not credited");
}
```

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### supply

Supply the base asset to earn interest, or supply collateral to enable borrowing.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supply(asset, amount);
  return 1;
}
```

- `cometAddress`: The specific Comet market (e.g. cUSDCv3, cWETHv3)
- `asset`: If base asset (e.g. USDC) -- earns interest. If collateral asset -- enables borrowing
- Requires ERC-20 approval to the Comet address

### withdraw

Withdraw base asset or collateral. If withdrawing more base than supplied, creates a borrow position.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdraw(asset, amount);
  return 1;
}
```

- Withdrawing base asset beyond your supply automatically borrows

### supplyTo

Supply assets on behalf of another address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, dst: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supplyTo(dst, asset, amount);
  return 1;
}
```

- `dst`: Destination address that receives the supply position

### withdrawTo

Withdraw assets to a specific address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, to: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdrawTo(to, asset, amount);
  return 1;
}
```

- `to`: Address that receives the withdrawn tokens

## Notes

- No separate borrow function -- withdrawing more base than supplied automatically borrows
- Each Comet market has ONE base asset (e.g. USDC) and multiple collateral assets
- No interest rate mode selection -- all borrows are variable rate
- Supply/withdraw of collateral does not earn interest, only the base asset earns
- Market names indicate the base asset: cUSDCv3 = USDC base, cWETHv3 = WETH base
- All supply operations require ERC-20 approval to the Comet address
- TVL: $3.5B+. Audited

## Its names in a program

On Ethereum, `CompoundV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cUSDCv3, `0xc3d688B66703497DAA19211EEdff47f25384cdc3`.
  require(CompoundV3.CUSDCv3 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `CompoundV3.CUSDCv3` |
| [Ethereum](../chains/ethereum.md) | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | `CompoundV3.CUSDTv3` |
| [Ethereum](../chains/ethereum.md) | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | `CompoundV3.CWETHv3` |
| [Optimism](../chains/optimism.md) | cUSDCv3 | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` | `CompoundV3.CUSDCv3` |
| [Polygon](../chains/polygon.md) | cUSDCv3 | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` | `CompoundV3.CUSDCv3` |
| [Base](../chains/base.md) | cUSDCv3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `CompoundV3.CUSDCv3` |
| [Base](../chains/base.md) | cWETHv3 | `0x46e6b214b524310239732D51387075E0e70970bf` | `CompoundV3.CWETHv3` |
| [Arbitrum One](../chains/arbitrum.md) | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `CompoundV3.CUSDCv3` |
| [Arbitrum One](../chains/arbitrum.md) | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `CompoundV3.CUSDTv3` |
| [Scroll](../chains/scroll.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CUSDCv3` |

## ABI

### `CometABI`

`import CometABI from "./protocols/compound-v3/CometABI.json";` Speaks for: cUSDCv3, cWETHv3, cUSDTv3.

- `supply(address asset, uint256 amount)`
- `supplyTo(address dst, address asset, uint256 amount)`
- `withdraw(address asset, uint256 amount)`
- `withdrawTo(address to, address asset, uint256 amount)`
- `balanceOf(address account) view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
