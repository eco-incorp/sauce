# Beefy Finance

Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.

## Category

yield | Chains: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche

## Key Operations

- **deposit**: Deposit want tokens into Beefy vault
- **depositAll**: Deposit entire balance of want token
- **withdraw**: Withdraw by specifying share amount
- **withdrawAll**: Withdraw entire position

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  deposit,
  depositAll,
  withdraw,
  withdrawAll,
} from "@eco-incorp/sauce/protocols/beefy";
```

## SauceScript Examples

```typescript
// Deposit into Beefy vault
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}

// Deposit entire balance
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.depositAll();
  return 1;
}

// Withdraw shares
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdraw(shares);
  return 1;
}

// Withdraw all
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdrawAll();
  return 1;
}
```

## Key Addresses

| Chain     | Contract | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | BIFI     | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` |
| BSC       | BIFI     | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` |
| Polygon   | BIFI     | `0xFbdd194376de19a88F4A68671C339563c427310d` |
| Arbitrum  | BIFI     | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` |
| Optimism  | BIFI     | `0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642` |
| Base      | BIFI     | `0xc55E93C62874D8100dBd2DfE307EDc1036ad5434` |
| Avalanche | BIFI     | `0xd6070ae98b8069de6B494332d1A1a81B6179D960` |

## ABI Methods

### BeefyVaultABI

- `deposit(uint256)` - Deposit want tokens, receive mooTokens (vault shares)
- `depositAll()` - Deposit entire want token balance
- `withdraw(uint256)` - Withdraw by burning shares
- `withdrawAll()` - Withdraw entire position
- `getPricePerFullShare()` - Current share price (18 decimals)
- `balance()` - Total want tokens in vault
- `balanceOf(address)` - Query mooToken (share) balance
- `want()` - Address of the underlying want token

## Notes

- TVL: $300M+. Each vault has a unique address per strategy
- Approve want token to vault before depositing
- Use want() to discover which token a vault accepts
- getPricePerFullShare() returns the exchange rate between shares and want tokens
- Auto-compounds rewards - no manual claiming needed
