# Fluid

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

## Category

lending | Chains and addresses: [registry/fluid.md](registry/fluid.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/fluid.md](registry/fluid.md).

## Notes

- Novel architecture: deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval (to the fToken or Vault)
- TVL: $1B+. Audited
