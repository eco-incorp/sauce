# GHO

Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.

## Category

cdp | Chains: Ethereum

## Key Operations

- **transfer**: Transfer GHO tokens
- **approve**: Approve GHO token spender

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/gho";
```

## SauceScript Examples

```typescript
// Transfer GHO
import { transfer } from "@sauce/token";
function main(ghoAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(ghoAddress, to, amount);
  return 1;
}

// Approve GHO spender
import { approve } from "@sauce/token";
function main(ghoAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(ghoAddress, spender, amount);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | gho      | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` |

## ABI Methods

### GhoTokenABI

- `transfer(address,uint256)` - Transfer GHO. Params: to, amount. Returns bool
- `approve(address,uint256)` - Approve spender. Params: spender, amount. Returns bool
- `balanceOf(address)` - Query balance. Params: account. Returns uint256

## Notes

- Minted via Aave V3 borrow (use Aave V3 Pool.borrow with GHO token address)
- Facilitator-based model - Aave V3 Pool is the primary facilitator
- GHO has a variable borrow rate set by Aave governance
- stkAAVE holders get a discount on GHO borrow rate
- To mint GHO: supply collateral to Aave V3, then borrow GHO
- To repay: use Aave V3 Pool.repay with GHO token address
