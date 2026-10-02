<!-- Generated from the SDK's registries. Do not edit. -->

# Renzo (`renzo`)

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a non-rebasing liquid restaked token.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Renzo` on ethereum |
| Chains | ethereum |

## Key Operations

- **depositETH**: Deposit ETH directly to receive ezETH
- **deposit**: Deposit LST collateral (stETH, etc.) to receive ezETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit ETH for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.depositETH();
  return 1;
}

// Deposit LST for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address, collateralToken: Address, amount: Uint256): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.deposit(collateralToken, amount);
  return 1;
}
```

## Notes

- TVL: $389M+. Built on EigenLayer restaking
- ezETH is non-rebasing - value accrues over time
- depositETH() is payable - send ETH as msg.value
- For LST deposits, approve the collateral token to restakeManager first

## Its names in a program

On Ethereum, `Renzo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ezETH, `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110`.
  require(Renzo.EzETH != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Ethereum](../chains/ethereum.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |

## ABI

### `EzETHABI`

`import EzETHABI from "./protocols/renzo/EzETHABI.json";` Speaks for: ezETH.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `RestakeManagerABI`

`import RestakeManagerABI from "./protocols/renzo/RestakeManagerABI.json";` Speaks for: restakeManager.

- `deposit(address _collateralToken, uint256 _amount)`
- `depositETH() payable`
