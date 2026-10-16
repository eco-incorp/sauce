<!-- Generated from the SDK's registries. Do not edit. -->

# Fluid (`fluid`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Fluid is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Fluid` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

The Liquidity layer (`liquidity` below) has no user-level deposit or borrow function: its only entry point, `operate`, is restricted to Fluid's own protocols. Users lend through **fTokens** (ERC-4626 vaults such as fUSDC) and borrow through **Vaults**.

### deposit

Deposit the fToken's underlying asset and receive fToken shares.

```typescript
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.deposit(amount, to);
}
```

- `fTokenAddress`: the fToken for the asset (e.g. fUSDC `0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33` on Ethereum)
- `to`: Address that receives the shares
- Returns the shares minted
- Requires ERC-20 approval of the underlying to the fToken

### withdraw

Withdraw an amount of the underlying asset, burning the owner's shares.

```typescript
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address, owner: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.withdraw(amount, to, owner);
}
```

- Returns the shares burned

### borrow

Borrow from a Vault position: `operate` with a positive debt delta.

```typescript
import { FluidVaultABI as IFluidVault } from "./abis";

function main(vaultAddress: Address, nftId: Uint256, amount: Uint256, to: Address): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, amount, to);
  return 1;
}
```

- `nftId`: the position NFT (0 opens a new position)
- The position must hold enough collateral (a positive `newCol` delta deposits it)

### repay

Repay a Vault position's debt: `operate` with a negative debt delta.

```typescript
import { FluidVaultABI as IFluidVault } from "./abis";

function main(
  vaultAddress: Address,
  nftId: Uint256,
  negativeDebtDelta: Uint256,
  to: Address,
): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, negativeDebtDelta, to);
  return 1;
}
```

- `negativeDebtDelta`: the repayment as a negative `int256`, passed in two's complement (`2**256 - amount`)
- Requires ERC-20 approval of the debt token to the Vault

## Notes

- Novel architecture: deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval (to the fToken or Vault)
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `Fluid` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's liquidity, `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497`.
  require(Fluid.Liquidity != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Arbitrum One](../chains/arbitrum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |

## ABI

### `FluidLendingABI`

`import FluidLendingABI from "./protocols/fluid/FluidLendingABI.json";`

- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `asset() view returns (address)`

### `FluidVaultABI`

`import FluidVaultABI from "./protocols/fluid/FluidVaultABI.json";`

- `operate(uint256 nftId, int256 newCol, int256 newDebt, address to) payable returns (uint256, int256, int256)`
