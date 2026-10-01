# Aave V3

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets. The most widely deployed lending protocol in DeFi.

## Category

lending | Chains: Ethereum (1), Polygon (137), Arbitrum (42161), Optimism (10), Avalanche (43114), Base (8453), BSC (56), Scroll (534352), Fantom (250), Gnosis (100), Metis (1088)

## SauceScript Functions

### supply

Supply assets to earn interest. Mints aTokens to the supplier.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `poolAddress`: Pool contract for the target chain
- `asset`: ERC-20 token address to supply
- `amount`: Amount in token's native decimals. Use `type(uint256).max` for entire balance
- `onBehalfOf`: Address that receives aTokens (use msg.sender for self)
- Requires ERC-20 approval to the Pool before calling

### withdraw

Withdraw supplied assets by burning aTokens.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw entire balance
- Returns the actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 1 = stable (being phased out), 2 = variable. Use 2 for variable rate
- Must have sufficient collateral supplied first

### repay

Repay borrowed assets to reduce debt.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `interestRateMode`: Must match the debt type (1 = stable, 2 = variable)
- `amount`: Use `type(uint256).max` to repay entire debt
- Requires ERC-20 approval to the Pool

## Deployed Addresses

| Chain     | Contract              | Address                                      |
| --------- | --------------------- | -------------------------------------------- |
| Ethereum  | pool                  | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Ethereum  | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` |
| Polygon   | pool                  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Polygon   | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Arbitrum  | pool                  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Arbitrum  | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Optimism  | pool                  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Optimism  | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Avalanche | pool                  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Avalanche | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` |
| Base      | pool                  | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Base      | poolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` |
| BSC       | pool                  | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` |
| Scroll    | pool                  | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` |
| Fantom    | pool                  | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Gnosis    | pool                  | `0xb50201558B00496A145fE76f7424749556E326D8` |
| Metis     | pool                  | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` |

## ABI Reference

### PoolABI

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` - Supply asset to earn interest
- `withdraw(address asset, uint256 amount, address to) returns (uint256)` - Withdraw supplied asset
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` - Borrow against collateral
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)` - Repay borrowed debt
- `flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)` - Single-asset flash loan (receiver must implement IFlashLoanSimpleReceiver)
- `liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)` - Liquidate undercollateralized position (healthFactor < 1e18)
- `getUserAccountData(address user) returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)` - Get account health data (view)

## Notes

- interestRateMode: 1 = stable (deprecated on most markets), 2 = variable
- referralCode is always 0 (referral program inactive)
- V3 introduced efficiency mode (eMode) for correlated assets, isolation mode for new assets, and siloed borrowing
- All supply/repay operations require prior ERC-20 approval to the Pool address
- healthFactor < 1e18 means position is liquidatable
- TVL: $40B+. Audited
