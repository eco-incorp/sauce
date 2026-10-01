# Tokemak

Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.

## Category

yield | Chains: Ethereum

## Key Operations

- **deposit**: Deposit assets into Autopool
- **withdraw**: Withdraw assets from Autopool
- **redeem**: Redeem Autopool shares

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  deposit,
  withdraw,
  redeem,
} from "@eco-incorp/sauce/protocols/tokemak";
```

## SauceScript Examples

```typescript
// Deposit into Tokemak Autopool
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.deposit(assets, receiver);
}
```

## Key Addresses

| Chain    | Contract         | Address                                      |
| -------- | ---------------- | -------------------------------------------- |
| Ethereum | toke             | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` |
| Ethereum | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` |

## ABI Methods

- `deposit(uint256,address)` - Deposit assets
- `withdraw(uint256,address,address)` - Withdraw assets
- `redeem(uint256,address,address)` - Redeem shares

## Notes

- Autopools are ERC-4626 vaults. Autopilot automatically rebalances across DeFi venues.
