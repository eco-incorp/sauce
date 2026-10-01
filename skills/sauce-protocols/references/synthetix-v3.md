# Synthetix V3

Modular liquidity protocol powering perpetual futures and synthetic assets on Base. Account-based system with collateral delegation to liquidity pools.

## Category

synthetics | Chains: Base

## Key Operations

- **deposit**: Deposit collateral into an account
- **withdraw**: Withdraw collateral from an account
- **delegateCollateral**: Delegate collateral to a pool (via CoreProxy)
- **commitOrder**: Commit a perps trade order (via PerpsMarketProxy)
- **modifyCollateral**: Modify perps account collateral

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  deposit,
  withdraw,
} from "@eco-incorp/sauce/protocols/synthetix-v3";
```

## SauceScript Examples

```typescript
// Deposit collateral
import { CoreProxyABI as ICoreProxy } from "./abis";
function main(
  coreProxyAddress: Address,
  accountId: Uint256,
  collateralType: Address,
  amount: Uint256,
): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.deposit(accountId, collateralType, amount);
  return 1;
}

// Withdraw collateral
import { CoreProxyABI as ICoreProxy } from "./abis";
function main(
  coreProxyAddress: Address,
  accountId: Uint256,
  collateralType: Address,
  amount: Uint256,
): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.withdraw(accountId, collateralType, amount);
  return 1;
}
```

## Key Addresses

| Chain | Contract         | Address                                      |
| ----- | ---------------- | -------------------------------------------- |
| Base  | coreProxy        | `0x32C222A9A159782aFD7529c87FA34b96CA72C696` |
| Base  | perpsMarketProxy | `0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce` |

## ABI Methods

### CoreProxyABI

- `deposit(uint128,address,uint256)` - Deposit collateral. Params: accountId, collateralType, tokenAmount
- `withdraw(uint128,address,uint256)` - Withdraw collateral. Same params as deposit
- `delegateCollateral(uint128,uint128,address,uint256,uint256)` - Delegate to pool. Params: accountId, poolId, collateralType, amount, leverage

### PerpsMarketProxyABI

- `commitOrder(tuple)` - Commit perps order. Tuple: { marketId uint128, accountId uint128, sizeDelta int128, settlementStrategyId uint128, acceptablePrice uint256, trackingCode bytes32, referrer address }
- `modifyCollateral(uint128,uint128,int256)` - Modify perps collateral. Params: accountId, synthMarketId, amountDelta (positive=add, negative=remove)

## Notes

- TVL: $300M+. Account-based system - create account NFT first
- accountId is uint128, collateral ops use token amount in token decimals
- delegateCollateral assigns collateral to a specific pool for earning fees
- commitOrder sizeDelta: positive = long, negative = short
- Settlement happens asynchronously via keepers after commitOrder
