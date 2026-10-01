# Opyn

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

## Category

options | Chains and addresses: [registry/opyn.md](registry/opyn.md)

## Key Operations

- **burnSqueeth**: Burn oSQTH to close/reduce a squeeth position
- **withdrawCollateral**: Withdraw ETH collateral from a vault
- **mintSqueeth**: Mint oSQTH (open squeeth position) by depositing ETH collateral
- **deposit**: Deposit additional ETH collateral to an existing vault

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/opyn.md](registry/opyn.md).

## Notes

- Squeeth = squared ETH exposure (ETH^2), providing leveraged upside without liquidations
- Funding rate applies instead of liquidations - long positions pay short positions
- oSQTH is the ERC-20 power perpetual token
- Vaults hold ETH collateral backing minted oSQTH
- vaultId=0 in mintPowerPerpAmount creates a new vault
- Can use Uniswap V3 LP NFTs as collateral via uniTokenId parameter
