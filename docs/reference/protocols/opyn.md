<!-- Generated from the SDK's registries. Do not edit. -->

# Opyn (`opyn`)

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Opyn` on ethereum |
| Chains | ethereum |

## Key Operations

- **burnSqueeth**: Burn oSQTH to close/reduce a squeeth position
- **withdrawCollateral**: Withdraw ETH collateral from a vault
- **mintSqueeth**: Mint oSQTH (open squeeth position) by depositing ETH collateral
- **deposit**: Deposit additional ETH collateral to an existing vault

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Burn Squeeth to reduce position
import { ControllerABI as IController } from "./abis";
function main(
  controllerAddress: Address,
  vaultId: Uint256,
  amount: Uint256,
  withdrawAmount: Uint256,
): Uint256 {
  const controller = IController.at(controllerAddress);
  controller.burnPowerPerpAmount(vaultId, amount, withdrawAmount);
  return 1;
}

// Withdraw collateral from vault
import { ControllerABI as IController } from "./abis";
function main(controllerAddress: Address, vaultId: Uint256, amount: Uint256): Uint256 {
  const controller = IController.at(controllerAddress);
  controller.withdraw(vaultId, amount);
  return 1;
}
```

## Notes

- Squeeth = squared ETH exposure (ETH^2), providing leveraged upside without liquidations
- Funding rate applies instead of liquidations - long positions pay short positions
- oSQTH is the ERC-20 power perpetual token
- Vaults hold ETH collateral backing minted oSQTH
- vaultId=0 in mintPowerPerpAmount creates a new vault
- Can use Uniswap V3 LP NFTs as collateral via uniTokenId parameter

## Its names in a program

On Ethereum, `Opyn` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's controller, `0x64187ae08781B09368e6253F9E94951243A493D5`.
  require(Opyn.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Ethereum](../chains/ethereum.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |

## ABI

### `ControllerABI`

`import ControllerABI from "./protocols/opyn/ControllerABI.json";` Speaks for: controller.

- `mintPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _uniTokenId) payable returns (uint256, uint256)`
- `burnPowerPerpAmount(uint256 _vaultId, uint256 _powerPerpAmount, uint256 _withdrawAmount) returns (uint256 wPowerPerpAmount)`
- `deposit(uint256 _vaultId) payable`
- `withdraw(uint256 _vaultId, uint256 _amount)`
