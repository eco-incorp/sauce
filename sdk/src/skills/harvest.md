# Harvest Finance

Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.

## Category

yield | Chains: Ethereum

## Key Operations

- **deposit**: Deposit tokens into Harvest vault
- **withdraw**: Withdraw tokens from vault
- **getPricePerFullShare**: Query vault share price

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/harvest";
```

## SauceScript Examples

```typescript
// Deposit into Harvest vault
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` |
| Ethereum | farm       | `0xa0246c9032bC3A600820415aE600c6388619A14D` |

## ABI Methods

- `deposit(uint256) returns (uint256)` - Deposit tokens
- `withdraw(uint256) returns (uint256)` - Withdraw shares
- `getPricePerFullShare()` - Get share price

## Notes

- FARM token for governance. Auto-compounds strategy rewards.
