# Yearn V3

Yield aggregator protocol. V3 vaults follow the ERC-4626 standard for automated yield optimization with multi-strategy allocations.

## Category

yield | Chains: Ethereum

## Key Operations

- **deposit**: Deposit assets into vault, receive yield-bearing shares
- **withdraw**: Withdraw assets by specifying asset amount
- **redeem**: Withdraw by specifying share amount

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/yearn-v3";
```

## SauceScript Examples

```typescript
// Deposit into Yearn V3 vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.deposit(assets, receiver);
}

// Withdraw from vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.withdraw(assets, receiver, owner);
}

// Redeem shares
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Key Addresses

| Chain    | Contract     | Address                                      |
| -------- | ------------ | -------------------------------------------- |
| Ethereum | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F` |

## ABI Methods

### YearnV3VaultABI (ERC-4626)

- `deposit(uint256,address)` - Deposit assets, receive shares. Returns shares minted
- `withdraw(uint256,address,address)` - Withdraw by asset amount. Params: assets, receiver, owner
- `redeem(uint256,address,address)` - Redeem by share amount. Returns assets
- `convertToShares(uint256)` - Preview shares for asset amount
- `convertToAssets(uint256)` - Preview assets for share amount
- `totalAssets()` - Total assets managed by vault
- `pricePerShare()` - Current share price (Yearn-specific, equivalent to convertToAssets(1e18))
- `balanceOf(address)` - Query vault share balance
- `approve(address,uint256)` - Approve share spending

## Notes

- TVL: $500M+. ERC-4626 compliant (same interface as sfrxETH, pufETH, sDAI)
- Each vault has a unique address per underlying asset + strategy combination
- Approve underlying token to vault before depositing
- Vaults are deployed via factory - no single canonical vault address
