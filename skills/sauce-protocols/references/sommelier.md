# Sommelier

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

## Category

yield | Chains: Ethereum

## Key Operations

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  deposit,
  withdraw,
  redeem,
} from "@eco-incorp/sauce/protocols/sommelier";
```

## SauceScript Examples

```typescript
// Deposit into Sommelier Cellar
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.deposit(assets, receiver);
}
```

## Key Addresses

| Chain    | Contract     | Address                                      |
| -------- | ------------ | -------------------------------------------- |
| Ethereum | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` |

## ABI Methods

- `deposit(uint256,address)` - Deposit assets
- `withdraw(uint256,address,address)` - Withdraw assets
- `redeem(uint256,address,address)` - Redeem shares

## Notes

- Cellars are ERC-4626 vaults. Strategies managed off-chain via Cosmos governance.
