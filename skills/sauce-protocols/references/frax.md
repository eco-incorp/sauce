# Frax Finance

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

## Category

cdp | Chains: Ethereum

## Key Operations

- **transfer**: Transfer FRAX tokens
- **approve**: Approve FRAX token spender

## SDK Usage

```typescript
import { protocolInfo, deployments, transfer, approve } from "@eco-incorp/sauce/protocols/frax";
```

## SauceScript Examples

```typescript
// Transfer FRAX
import { transfer } from "@sauce/token";
function main(fraxAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(fraxAddress, to, amount);
  return 1;
}

// Approve FRAX spender
import { approve } from "@sauce/token";
function main(fraxAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(fraxAddress, spender, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | frax     | `0x853d955aCEf822Db058eb8505911ED77F175b99e` |

## ABI Methods

### FraxERC20ABI

- `transfer(address,uint256)` - Transfer FRAX. Params: to, amount. Returns bool
- `approve(address,uint256)` - Approve spender. Params: spender, amount. Returns bool
- `balanceOf(address)` - Query balance. Params: account. Returns uint256

## Notes

- TVL: $1B+. V1 was fractional-algorithmic, V2 (Frax v3) is fully collateralized
- FXS is the governance/value accrual token
- sFRAX is the staked FRAX vault (ERC-4626) for earning yield - see frax-ether module for sfrxETH
- Frax ecosystem includes: FRAX (stablecoin), frxETH/sfrxETH (liquid staking), FPI (inflation-pegged)
