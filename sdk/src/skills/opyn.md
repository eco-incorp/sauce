# Opyn

DeFi options protocol known for Squeeth (squared ETH), a power perpetual that provides leveraged ETH exposure without liquidations.

## Category

options | Chains: Ethereum

## Key Operations

- **burnSqueeth**: Burn oSQTH to close/reduce a squeeth position
- **withdrawCollateral**: Withdraw ETH collateral from a vault
- **mintSqueeth**: Mint oSQTH (open squeeth position) by depositing ETH collateral
- **deposit**: Deposit additional ETH collateral to an existing vault

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/opyn";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` |
| Ethereum | oSQTH      | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` |

## ABI Methods

### ControllerABI

- `mintPowerPerpAmount(uint256,uint256,uint256)` - Mint oSQTH. Params: vaultId (0 to create new), powerPerpAmount (oSQTH to mint), uniTokenId (Uniswap LP NFT as collateral, 0 for ETH). Payable (send ETH as collateral). Returns (vaultId, wPowerPerpAmount)
- `burnPowerPerpAmount(uint256,uint256,uint256) returns (uint256)` - Burn oSQTH to close position. Params: vaultId, powerPerpAmount (oSQTH to burn), withdrawAmount (ETH collateral to withdraw)
- `deposit(uint256)` - Deposit additional ETH collateral. Params: vaultId. Payable (ETH sent = deposit amount)
- `withdraw(uint256,uint256)` - Withdraw ETH collateral. Params: vaultId, amount (ETH to withdraw)

## Notes

- Squeeth = squared ETH exposure (ETH^2), providing leveraged upside without liquidations
- Funding rate applies instead of liquidations - long positions pay short positions
- oSQTH is the ERC-20 power perpetual token
- Vaults hold ETH collateral backing minted oSQTH
- vaultId=0 in mintPowerPerpAmount creates a new vault
- Can use Uniswap V3 LP NFTs as collateral via uniTokenId parameter
