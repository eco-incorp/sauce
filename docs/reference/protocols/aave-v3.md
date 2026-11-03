<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V3 (`aave-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aave V3 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV3` on ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| Chains | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |

## When to use it

- Earn interest on an asset the market lists, or borrow one against everything you supplied in
  that market. One Pool per market holds every reserve.
- Choose it over Compound V3 when you need to borrow more than one asset against shared
  collateral, and over Morpho Blue when you want one shared market rather than isolated ones.

## Pitfalls for a program

- `supply` pulls the asset with `transferFrom`: approve the Pool for exactly the amount first.
- `onBehalfOf` receives the aTokens, and with them the position. Every call comes from the Pot,
  so `pot` there keeps the position in the Pot, not in the user's wallet; choose which, and
  pass the wallet as a `main` parameter to give it to the user. A position in the wallet is the
  wallet's: `withdraw` burns the caller's aTokens, so a later cook withdraws it only once they are
  back in the Pot, and borrows against it only with the wallet's credit delegation.
- The aToken minted to `onBehalfOf` is rebasing: its balance grows with interest, so measure it
  as a delta, not as the amount supplied.
- A reserve can be frozen, paused or at its supply cap, and then `supply` reverts.
- Borrowing needs collateral and keeps the position's health factor (from
  `getUserAccountData`, scaled by 1e18) above 1; below it, anyone may liquidate.
- `withdraw` with `~0` withdraws everything; it reverts if that would leave a borrow
  undercollateralized.
- `flashLoanSimple` calls back a receiver contract, which a Sauce program cannot be.

## In a Sauce program

Supply the Pot's USDC for `onBehalfOf` (the user's wallet, or `pot` to keep the position in
the Pot) and check the position now has collateral:

```ts
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
  const account = AaveV3.Pool.getUserAccountData(onBehalfOf);
  require(account.totalCollateralBase > 0, "nothing supplied");
}
```

## Notes

- interestRateMode: 1 = stable (deprecated on most markets), 2 = variable
- referralCode is always 0 (referral program inactive)
- V3 introduced efficiency mode (eMode) for correlated assets, isolation mode for new assets, and siloed borrowing
- All supply/repay operations require prior ERC-20 approval to the Pool address
- healthFactor < 1e18 means position is liquidatable
- TVL: $40B+. Audited

## Its names in a program

On Ethereum, `AaveV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's oracle, `0x54586bE62E3c3580375aE3723C145253060Ca0C2`.
  require(AaveV3.Oracle != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | oracle | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` | `AaveV3.Oracle` |
| [Ethereum](../chains/ethereum.md) | pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Ethereum](../chains/ethereum.md) | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | `AaveV3.PoolAddressesProvider` |
| [Optimism](../chains/optimism.md) | oracle | `0xD81eb3728a631871a7eBBaD631b5f424909f0c77` | `AaveV3.Oracle` |
| [Optimism](../chains/optimism.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `dropReserve`, `resetIsolationModeTotalDebt` |
| [Optimism](../chains/optimism.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [BNB Chain](../chains/bsc.md) | oracle | `0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697` | `AaveV3.Oracle` |
| [BNB Chain](../chains/bsc.md) | pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [BNB Chain](../chains/bsc.md) | poolAddressesProvider | `0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D` | `AaveV3.PoolAddressesProvider` |
| [Gnosis](../chains/gnosis.md) | oracle | `0xeb0a051be10228213BAEb449db63719d6742F7c4` | `AaveV3.Oracle` |
| [Gnosis](../chains/gnosis.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Gnosis](../chains/gnosis.md) | poolAddressesProvider | `0x36616cf17557639614c1cdDb356b1B83fc0B2132` | `AaveV3.PoolAddressesProvider` |
| [Polygon](../chains/polygon.md) | oracle | `0xb023e699F5a33916Ea823A16485e259257cA8Bd1` | `AaveV3.Oracle` |
| [Polygon](../chains/polygon.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Polygon](../chains/polygon.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Monad](../chains/monad.md) | oracle | `0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf` | `AaveV3.Oracle` |
| [Monad](../chains/monad.md) | pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Monad](../chains/monad.md) | poolAddressesProvider | `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615` | `AaveV3.PoolAddressesProvider` |
| [Fantom](../chains/fantom.md) | oracle | `0xfd6f3c1845604C8AE6c6E402ad17fb9885160754` | `AaveV3.Oracle` |
| [Fantom](../chains/fantom.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `approvePositionManager`, `borrow`, `configureEModeCategory`, `configureEModeCategoryBorrowableBitmap`, `configureEModeCategoryCollateralBitmap`, `configureEModeCategoryIsolated`, `configureEModeCategoryLtvzeroBitmap`, `eliminateReserveDeficit`, `finalizeTransfer`, `getBorrowLogic`, `getEModeCategoryBorrowableBitmap`, `getEModeCategoryCollateralBitmap`, `getEModeCategoryCollateralConfig`, `getEModeCategoryLabel`, `getEModeCategoryLtvzeroBitmap`, `getFlashLoanLogic`, `getIsEModeCategoryIsolated`, `getLiquidationGracePeriod`, `getLiquidationLogic`, `getPoolLogic`, `getReserveAToken`, `getReserveDeficit`, `getReservesCount`, `getReserveVariableDebtToken`, `getSupplyLogic`, `getVirtualUnderlyingBalance`, `initReserve`, `isApprovedPositionManager`, `liquidationCall`, `multicall`, `renouncePositionManagerRole`, `repay`, `repayWithATokens`, `repayWithPermit`, `RESERVE_INTEREST_RATE_STRATEGY`, `setLiquidationGracePeriod`, `setUserEModeOnBehalfOf`, `setUserUseReserveAsCollateral`, `setUserUseReserveAsCollateralOnBehalfOf`, `supply`, `supplyWithPermit`, `syncIndexesState`, `syncRatesState`, `UMBRELLA`, `updateFlashloanPremium`, `withdraw` |
| [Fantom](../chains/fantom.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Metis](../chains/metis.md) | oracle | `0x38D36e85E47eA6ff0d18B0adF12E5fC8984A6f8e` | `AaveV3.Oracle` |
| [Metis](../chains/metis.md) | pool | `0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57` | `AaveV3.Pool`; not on this deployment: `configureEModeCategory`, `configureEModeCategoryIsolated`, `getIsEModeCategoryIsolated` |
| [Metis](../chains/metis.md) | poolAddressesProvider | `0xB9FABd7500B2C6781c35Dd48d54f81fc2299D7AF` | `AaveV3.PoolAddressesProvider` |
| [Base](../chains/base.md) | oracle | `0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156` | `AaveV3.Oracle` |
| [Base](../chains/base.md) | pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `AaveV3.Pool`; not on this deployment: `dropReserve`, `resetIsolationModeTotalDebt` |
| [Base](../chains/base.md) | poolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | `AaveV3.PoolAddressesProvider` |
| [Arbitrum One](../chains/arbitrum.md) | oracle | `0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7` | `AaveV3.Oracle` |
| [Arbitrum One](../chains/arbitrum.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `dropReserve`, `resetIsolationModeTotalDebt` |
| [Arbitrum One](../chains/arbitrum.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Avalanche C-Chain](../chains/avalanche.md) | oracle | `0xEBd36016B3eD09D4693Ed4251c67Bd858c3c7C9C` | `AaveV3.Oracle` |
| [Avalanche C-Chain](../chains/avalanche.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Avalanche C-Chain](../chains/avalanche.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Scroll](../chains/scroll.md) | oracle | `0x04421D8C506E2fA2371a08EfAaBf791F624054F3` | `AaveV3.Oracle` |
| [Scroll](../chains/scroll.md) | pool | `0x11fCfe756c05AD438e312a7fd934381537D3cFfe` | `AaveV3.Pool`; not on this deployment: `dropReserve`, `resetIsolationModeTotalDebt` |
| [Scroll](../chains/scroll.md) | poolAddressesProvider | `0x69850D0B276776781C063771b161bd8894BCdD04` | `AaveV3.PoolAddressesProvider` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `ATokenABI`

`import ATokenABI from "./protocols/aave-v3/ATokenABI.json";`

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `ATOKEN_REVISION() view returns (uint256)`
- `balanceOf(address user) view returns (uint256)`
- `burn(address from, address receiverOfUnderlying, uint256 amount, uint256 scaledAmount, uint256 index) returns (bool)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `EIP712_REVISION() view returns (bytes)`
- `getIncentivesController() view returns (address)`
- `getPreviousIndex(address user) view returns (uint256)`
- `getScaledUserBalanceAndSupply(address user) view returns (uint256, uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _logic, bytes _data) payable`
- `initialize(address initializingPool, address underlyingAsset, uint8 aTokenDecimals, string aTokenName, string aTokenSymbol, bytes params)`
- `mint(address caller, address onBehalfOf, uint256 scaledAmount, uint256 index) returns (bool)`
- `mintToTreasury(uint256 scaledAmount, uint256 index)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `POOL() view returns (address)`
- `renounceAllowance(address owner)`
- `rescueTokens(address token, address to, uint256 amount)`
- `RESERVE_TREASURY_ADDRESS() view returns (address)`
- `REWARDS_CONTROLLER() view returns (address)`
- `scaledBalanceOf(address user) view returns (uint256)`
- `scaledTotalSupply() view returns (uint256)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address recipient, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `transferOnLiquidation(address from, address to, uint256 amount, uint256 scaledAmount, uint256 index)`
- `transferUnderlyingTo(address target, uint256 amount)`
- `TREASURY() view returns (address)`
- `UNDERLYING_ASSET_ADDRESS() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `error CallerMustBePool` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSAInvalidSignatureS` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC20InsufficientAllowance` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidBurnAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidExpiration` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMintAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeCastOverflowedUintDowncast` taking `(uint8,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `AaveOracleABI`

`import AaveOracleABI from "./protocols/aave-v3/AaveOracleABI.json";` Speaks for: oracle. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `ADDRESSES_PROVIDER() view returns (address)`
- `BASE_CURRENCY() view returns (address)`
- `BASE_CURRENCY_UNIT() view returns (uint256)`
- `getAssetPrice(address asset) view returns (uint256)`
- `getAssetsPrices(address[] assets) view returns (uint256[])`
- `getFallbackOracle() view returns (address)`
- `getSourceOfAsset(address asset) view returns (address)`
- `setAssetSources(address[] assets, address[] sources)`
- `setFallbackOracle(address fallbackOracle)`

Left out of this ABI, though its deployments declare them:

- `event BaseCurrencySet` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `PoolABI`

`import PoolABI from "./protocols/aave-v3/PoolABI.json";` Speaks for: pool. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `ADDRESSES_PROVIDER() view returns (address)`
- `approvePositionManager(address positionManager, bool approve)`
- `borrow(bytes32 args)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `configureEModeCategory(uint8 id, (uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus, bool isolated, string label) category)`
- `configureEModeCategoryBorrowableBitmap(uint8 id, uint128 borrowableBitmap)`
- `configureEModeCategoryCollateralBitmap(uint8 id, uint128 collateralBitmap)`
- `configureEModeCategoryIsolated(uint8 id, bool isolated)`
- `configureEModeCategoryLtvzeroBitmap(uint8 id, uint128 ltvzeroBitmap)`
- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `dropReserve(address asset)`
- `eliminateReserveDeficit(address asset, uint256 amount) returns (uint256)`
- `finalizeTransfer(address asset, address from, address to, uint256 scaledAmount, uint256 scaledBalanceFromBefore)`
- `flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] interestRateModes, address onBehalfOf, bytes params, uint16 referralCode)`
- `FLASHLOAN_PREMIUM_TO_PROTOCOL() view returns (uint128)`
- `FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)`
- `flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)`
- `getBorrowLogic() pure returns (address)`
- `getConfiguration(address asset) view returns ((uint256 data))`
- `getEModeCategoryBorrowableBitmap(uint8 id) view returns (uint128)`
- `getEModeCategoryCollateralBitmap(uint8 id) view returns (uint128)`
- `getEModeCategoryCollateralConfig(uint8 id) view returns ((uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus) res)`
- `getEModeCategoryData(uint8 id) view returns ((uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus, address priceSource, string label))`
- `getEModeCategoryLabel(uint8 id) view returns (string)`
- `getEModeCategoryLtvzeroBitmap(uint8 id) view returns (uint128)`
- `getFlashLoanLogic() pure returns (address)`
- `getIsEModeCategoryIsolated(uint8 id) view returns (bool)`
- `getLiquidationGracePeriod(address asset) view returns (uint40)`
- `getLiquidationLogic() pure returns (address)`
- `getPoolLogic() pure returns (address)`
- `getReserveAddressById(uint16 id) view returns (address)`
- `getReserveAToken(address asset) view returns (address)`: the address is a `AaveV3.AToken`
- `getReserveData(address asset) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt) res)`: `aTokenAddress` is a `AaveV3.AToken`, `variableDebtTokenAddress` is a `AaveV3.VariableDebtToken`
- `getReserveDeficit(address asset) view returns (uint256)`
- `getReserveNormalizedIncome(address asset) view returns (uint256)`
- `getReserveNormalizedVariableDebt(address asset) view returns (uint256)`
- `getReservesCount() view returns (uint256)`
- `getReservesList() view returns (address[])`
- `getReserveVariableDebtToken(address asset) view returns (address)`: the address is a `AaveV3.VariableDebtToken`
- `getSupplyLogic() pure returns (address)`
- `getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)`
- `getUserConfiguration(address user) view returns ((uint256 data))`
- `getUserEMode(address user) view returns (uint256)`
- `getVirtualUnderlyingBalance(address asset) view returns (uint128)`
- `initialize(address provider)`
- `initialize(address _logic, bytes _data) payable`
- `initReserve(address asset, address aTokenAddress, address variableDebtAddress)`
- `isApprovedPositionManager(address user, address positionManager) view returns (bool)`
- `liquidationCall(bytes32 args1, bytes32 args2)`
- `liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)`
- `MAX_NUMBER_RESERVES() view returns (uint16)`
- `mintToTreasury(address[] assets)`
- `multicall(bytes[] data) returns (bytes[] results)`
- `POOL_REVISION() view returns (uint256)`
- `renouncePositionManagerRole(address user)`
- `repay(bytes32 args) returns (uint256)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
- `repayWithATokens(bytes32 args) returns (uint256)`
- `repayWithATokens(address asset, uint256 amount, uint256 interestRateMode) returns (uint256)`
- `repayWithPermit(bytes32 args, bytes32 r, bytes32 s) returns (uint256)`
- `repayWithPermit(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS) returns (uint256)`
- `rescueTokens(address token, address to, uint256 amount)`
- `RESERVE_INTEREST_RATE_STRATEGY() view returns (address)`
- `resetIsolationModeTotalDebt(address asset)`
- `setConfiguration(address asset, (uint256 data) configuration)`
- `setLiquidationGracePeriod(address asset, uint40 until)`
- `setUserEMode(uint8 categoryId)`
- `setUserEModeOnBehalfOf(uint8 categoryId, address onBehalfOf)`
- `setUserUseReserveAsCollateral(bytes32 args)`
- `setUserUseReserveAsCollateral(address asset, bool useAsCollateral)`
- `setUserUseReserveAsCollateralOnBehalfOf(address asset, bool useAsCollateral, address onBehalfOf)`
- `supply(bytes32 args)`
- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `supplyWithPermit(bytes32 args, bytes32 r, bytes32 s)`
- `supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)`
- `syncIndexesState(address asset)`
- `syncRatesState(address asset)`
- `UMBRELLA() view returns (bytes32)`
- `updateFlashloanPremium(uint128 flashLoanPremium)`
- `withdraw(bytes32 args) returns (uint256)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`

Not on Ethereum's pool (`0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Optimism's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), whose code does not dispatch them or does not declare them as listed here: `dropReserve`, `resetIsolationModeTotalDebt`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on BNB Chain's pool (`0x6807dc923806fE8Fd134338EABCA509979a7e0cB`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Gnosis's pool (`0xb50201558B00496A145fE76f7424749556E326D8`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for Gnosis is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Monad's pool (`0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for Monad is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Fantom's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), whose code does not dispatch them or does not declare them as listed here: `approvePositionManager`, `borrow`, `configureEModeCategory`, `configureEModeCategoryBorrowableBitmap`, `configureEModeCategoryCollateralBitmap`, `configureEModeCategoryIsolated`, `configureEModeCategoryLtvzeroBitmap`, `eliminateReserveDeficit`, `finalizeTransfer`, `getBorrowLogic`, `getEModeCategoryBorrowableBitmap`, `getEModeCategoryCollateralBitmap`, `getEModeCategoryCollateralConfig`, `getEModeCategoryLabel`, `getEModeCategoryLtvzeroBitmap`, `getFlashLoanLogic`, `getIsEModeCategoryIsolated`, `getLiquidationGracePeriod`, `getLiquidationLogic`, `getPoolLogic`, `getReserveAToken`, `getReserveDeficit`, `getReservesCount`, `getReserveVariableDebtToken`, `getSupplyLogic`, `getVirtualUnderlyingBalance`, `initReserve`, `isApprovedPositionManager`, `liquidationCall`, `multicall`, `renouncePositionManagerRole`, `repay`, `repayWithATokens`, `repayWithPermit`, `RESERVE_INTEREST_RATE_STRATEGY`, `setLiquidationGracePeriod`, `setUserEModeOnBehalfOf`, `setUserUseReserveAsCollateral`, `setUserUseReserveAsCollateralOnBehalfOf`, `supply`, `supplyWithPermit`, `syncIndexesState`, `syncRatesState`, `UMBRELLA`, `updateFlashloanPremium`, `withdraw`. Do not call them there: a program compiled for Fantom is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Metis's pool (`0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57`), whose code does not dispatch them or does not declare them as listed here: `configureEModeCategory`, `configureEModeCategoryIsolated`, `getIsEModeCategoryIsolated`. Do not call them there: a program compiled for Metis is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's pool (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`), whose code does not dispatch them or does not declare them as listed here: `dropReserve`, `resetIsolationModeTotalDebt`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), whose code does not dispatch them or does not declare them as listed here: `dropReserve`, `resetIsolationModeTotalDebt`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), whose code does not dispatch them or does not declare them as listed here: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Scroll's pool (`0x11fCfe756c05AD438e312a7fd934381537D3cFfe`), whose code does not dispatch them or does not declare them as listed here: `dropReserve`, `resetIsolationModeTotalDebt`. Do not call them there: a program compiled for Scroll is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI by name, and called by their signature through the namespace:

- `AaveV3.Pool["configureEModeCategory(uint8,(uint16,uint16,uint16,string))"](…)`: `configureEModeCategory(uint8 id, (uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus, string label) category)`; an overload of configureEModeCategory(uint8,(uint16,uint16,uint16,bool,string)), which takes as many arguments: a call by name picks its overload by argument count, so this one is called by its signature. Not run by Ethereum's pool (`0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`), Optimism's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), BNB Chain's pool (`0x6807dc923806fE8Fd134338EABCA509979a7e0cB`), Gnosis's pool (`0xb50201558B00496A145fE76f7424749556E326D8`), Polygon's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), Monad's pool (`0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`), Fantom's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), Base's pool (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`), Arbitrum One's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), Avalanche C-Chain's pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`), Scroll's pool (`0x11fCfe756c05AD438e312a7fd934381537D3cFfe`): a program compiled for Ethereum, Optimism, BNB Chain, Gnosis, Polygon, Monad, Fantom, Base, Arbitrum One, Avalanche C-Chain, Scroll is refused it.

Left out of this ABI, though its deployments declare them:

- `error CallerNotPositionManager` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ReserveUsedAsCollateralEnabled` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `PoolAddressesProviderABI`

`import PoolAddressesProviderABI from "./protocols/aave-v3/PoolAddressesProviderABI.json";` Speaks for: poolAddressesProvider. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `getACLAdmin() view returns (address)`
- `getACLManager() view returns (address)`
- `getAddress(bytes32 id) view returns (address)`
- `getMarketId() view returns (string)`
- `getPool() view returns (address)`: the address is a `AaveV3.Pool`
- `getPoolConfigurator() view returns (address)`
- `getPoolDataProvider() view returns (address)`
- `getPriceOracle() view returns (address)`: the address is a `AaveV3.Oracle`
- `getPriceOracleSentinel() view returns (address)`
- `owner() view returns (address)`
- `renounceOwnership()`
- `setACLAdmin(address newAclAdmin)`
- `setACLManager(address newAclManager)`
- `setAddress(bytes32 id, address newAddress)`
- `setAddressAsProxy(bytes32 id, address newImplementationAddress)`
- `setMarketId(string newMarketId)`
- `setPoolConfiguratorImpl(address newPoolConfiguratorImpl)`
- `setPoolDataProvider(address newDataProvider)`
- `setPoolImpl(address newPoolImpl)`
- `setPriceOracle(address newPriceOracle)`
- `setPriceOracleSentinel(address newPriceOracleSentinel)`
- `transferOwnership(address newOwner)`

### `VariableDebtTokenABI`

`import VariableDebtTokenABI from "./protocols/aave-v3/VariableDebtTokenABI.json";`

- `allowance(address, address) view returns (uint256)`
- `approve(address, uint256) returns (bool)`
- `approveDelegation(address delegatee, uint256 amount)`
- `balanceOf(address user) view returns (uint256)`
- `borrowAllowance(address fromUser, address toUser) view returns (uint256)`
- `burn(address from, uint256 scaledAmount, uint256 index) returns (bool, uint256)`
- `DEBT_TOKEN_REVISION() view returns (uint256)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address, uint256) returns (bool)`
- `DELEGATION_WITH_SIG_TYPEHASH() view returns (bytes32)`
- `delegationWithSig(address delegator, address delegatee, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `EIP712_REVISION() view returns (bytes)`
- `getIncentivesController() view returns (address)`
- `getPreviousIndex(address user) view returns (uint256)`
- `getScaledUserBalanceAndSupply(address user) view returns (uint256, uint256)`
- `increaseAllowance(address, uint256) returns (bool)`
- `initialize(address _logic, bytes _data) payable`
- `initialize(address initializingPool, address underlyingAsset, uint8 debtTokenDecimals, string debtTokenName, string debtTokenSymbol, bytes params)`
- `mint(address user, address onBehalfOf, uint256 amount, uint256 scaledAmount, uint256 index) returns (uint256)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `POOL() view returns (address)`
- `renounceAllowance(address)`
- `renounceDelegation(address delegator)`
- `REWARDS_CONTROLLER() view returns (address)`
- `scaledBalanceOf(address user) view returns (uint256)`
- `scaledTotalSupply() view returns (uint256)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address, uint256) returns (bool)`
- `transferFrom(address, address, uint256) returns (bool)`
- `UNDERLYING_ASSET_ADDRESS() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `error CallerMustBePool` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSAInvalidSignatureS` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC20InsufficientAllowance` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidBurnAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidExpiration` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMintAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeCastOverflowedUintDowncast` taking `(uint8,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Approval` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
