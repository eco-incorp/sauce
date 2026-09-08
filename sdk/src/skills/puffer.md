# Puffer Finance

Liquid restaking protocol that issues pufETH via an ERC-4626 vault. Deposits are natively restaked via EigenLayer for additional yield.

## Category

restaking | Chains: Ethereum

## Key Operations

- **deposit**: Deposit assets into PufferVault, receive pufETH shares
- **redeem**: Redeem pufETH shares for underlying assets

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/puffer";
```

## SauceScript Examples

```typescript
// Deposit into PufferVault
import { PufferVaultABI as IPufferVault } from "./abis";
function main(pufferVaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.deposit(assets, receiver);
}

// Redeem pufETH shares
import { PufferVaultABI as IPufferVault } from "./abis";
function main(
  pufferVaultAddress: Address,
  shares: Uint256,
  receiver: Address,
  owner: Address,
): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Key Addresses

| Chain    | Contract             | Address                                      |
| -------- | -------------------- | -------------------------------------------- |
| Ethereum | pufETH / pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` |

## ABI Methods

### PufferVaultABI (ERC-4626)

- `deposit(uint256,address)` - Deposit assets, receive pufETH shares. Returns shares minted
- `redeem(uint256,address,address)` - Redeem shares for assets. Params: shares, receiver, owner
- `convertToShares(uint256)` - Preview shares for asset amount
- `convertToAssets(uint256)` - Preview assets for share amount
- `balanceOf(address)` - Query pufETH balance

## Notes

- TVL: $62M+. ERC-4626 vault interface (same as Yearn V3, sfrxETH, sDAI)
- pufETH is non-rebasing - exchange rate increases over time
- Natively restaked on EigenLayer
- Standard ERC-4626 deposit/redeem pattern
