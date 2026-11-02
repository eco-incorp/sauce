<!-- Generated from the SDK's registries. Do not edit. -->

# Level Finance (`level-finance`)

Decentralized perpetual exchange with risk-tranched liquidity pools and leveraged trading on BSC and Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `LevelFinance` on bsc, arbitrum |
| Chains | bsc, arbitrum |
| Document | [level-finance.md](../level-finance.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `LevelFinance` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's liquidityPool, `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874`.
  require(LevelFinance.LiquidityPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LevelFinance.LiquidityPool`; not on this deployment: `accrueInterest`, `addToken`, `borrowIndices`, `canSwap`, `daoFee`, `delistToken`, `feeReserves`, `getAllAssets`, `getAllTranches`, `globalShortSize`, `interestRate`, `interestRateModel`, `isValidLeverageTokenPair`, `lastAccrualTimestamps`, `liquidatePositionAllowed`, `liquidationFee`, `liquidityCalculator`, `pause`, `paused`, `poolBalances`, `positionFee`, `positionRevisions`, `reinit_setFeeDiscount`, `setController`, `setDaoFee`, `setFeeDistributor`, `setInterestRateModel`, `setLiquidityCalculator`, `setMaxLeverage`, `setOracle`, `setOrderManager`, `setPoolHook`, `setPositionFee`, `setRiskFactor`, `unpause` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LevelFinance.LiquidityPool` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/level-finance/LiquidityPoolABI.json";` Speaks for: liquidityPool. The import is the contract's full ABI across every deployment; call it through the `LevelFinance` namespace to have a function a chain's deployment does not run refused.

- `accrualInterval() view returns (uint256)`
- `accrueInterest(address _token) returns (uint256)`
- `addLiquidity(address tranche, address token, uint256 amountIn, uint256 minLpAmount, address to)`
- `addToken(address _token, bool _isStableCoin)`
- `allAssets(uint256) view returns (address)`
- `allowSwap(address) view returns (bool)`
- `allTranches(uint256) view returns (address)`
- `borrowIndices(address token) view returns (uint256)`
- `canSwap(address _tokenIn, address _tokenOut) view returns (bool)`
- `controller() view returns (address)`
- `daoFee() view returns (uint256)`
- `decreasePosition(address _owner, address _indexToken, address _collateralToken, uint256 _collateralChanged, uint256 _sizeChanged, uint8 _side, address _receiver)`
- `delistToken(address _token)`
- `feeDiscount() view returns (address)`
- `feeDistributor() view returns (address)`
- `feeReserves(address token) view returns (uint256)`
- `getAllAssets() view returns (address[] assets, bool[] isStable)`
- `getAllTranches() view returns (address[] tranches)`
- `getPoolAsset(address _token) view returns ((uint256 poolAmount, uint256 reservedAmount, uint256 guaranteedValue, uint256 totalShortSize, uint256 averageShortPrice))`
- `globalShortSize() view returns (uint256)`
- `increasePosition(address _owner, address _indexToken, address _collateralToken, uint256 _sizeChanged, uint8 _side)`
- `interestRate(address _token) view returns (uint256)`
- `interestRateModel(address token) view returns (address)`
- `isAsset(address) view returns (bool)`
- `isListed(address token) view returns (bool)`
- `isStableCoin(address token) view returns (bool)`
- `isTranche(address lpToken) view returns (bool)`
- `isValidLeverageTokenPair(address _indexToken, address _collateralToken, uint8 _side, bool _isIncrease) view returns (bool)`
- `lastAccrualTimestamps(address token) view returns (uint256)`
- `liquidatePosition(address _account, address _indexToken, address _collateralToken, uint8 _side)`
- `liquidatePositionAllowed(address _account, address _indexToken, address _collateralToken, uint8 _side) view returns (bool)`
- `liquidationFee() view returns (uint256)`
- `liquidityCalculator() view returns (address)`
- `maintenanceMargin() view returns (uint256)`
- `maxGlobalLongSizeRatios(address indexToken) view returns (uint256)`
- `maxGlobalShortSizes(address indexToken) view returns (uint256)`
- `maxLeverage() view returns (uint256)`
- `maxLiquidity(address token) view returns (uint256 amount)`
- `migrateLP(address _fromTranche, uint256 _lpAmount, address _viaToken, uint256 _minOut, address _to)`
- `oracle() view returns (address)`
- `orderManager() view returns (address)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `poolBalances(address token) view returns (uint256)`
- `poolHook() view returns (address)`
- `positionFee() view returns (uint256)`
- `positionOpenTimestamp(bytes32 positionKey) view returns (uint256)`
- `positionRevisions(bytes32 positionKey) view returns (uint256)`
- `positions(bytes32 positionKey) view returns (uint256 size, uint256 collateralValue, uint256 reserveAmount, uint256 entryPrice, uint256 borrowIndex)`
- `rebalanceAsset(address _fromTranche, address _fromToken, uint256 _fromAmount, address _toTranche, address _toToken)`
- `refreshVirtualPoolValue()`
- `reinit_setFeeDiscount(address _feeDiscount)`
- `removeLiquidity(address tranche, address tokenOut, uint256 lpAmount, uint256 minOut, address to)`
- `renounceOwnership()`
- `riskFactor(address token, address tranche) view returns (uint256 factor)`
- `setController(address _controller)`
- `setDaoFee(uint256 _daoFee)`
- `setFeeDistributor(address _feeDistributor)`
- `setInterestRateModel(address _token, address _interestRateModel)`
- `setLiquidityCalculator(address _liquidityManager)`
- `setMaxGlobalPositionSize(address _token, uint256 _maxGlobalLongRatio, uint256 _maxGlobalShortSize)`
- `setMaxLeverage(uint256 _maxLeverage)`
- `setMaxLiquidity(address _asset, uint256 _value)`
- `setOracle(address _oracle)`
- `setOrderManager(address _orderManager)`
- `setPoolHook(address _hook)`
- `setPositionFee(uint256 _positionFee, uint256 _liquidationFee)`
- `setRiskFactor(address _token, (address tranche, uint256 riskFactor)[] _config)`
- `setSwapAllowed(address _sender, bool _allowed)`
- `setTargetWeight((address token, uint256 weight)[] tokens)`
- `swap(address tokenIn, address tokenOut, uint256 minOut, address to, bytes extradata)`
- `targetWeights(address token) view returns (uint256)`
- `totalRiskFactor(address token) view returns (uint256 totalFactor)`
- `totalWeight() view returns (uint256)`
- `trancheAssets(address tranche, address token) view returns (uint256 poolAmount, uint256 reservedAmount, uint256 guaranteedValue, uint256 totalShortSize, uint256 averageShortPrice)`
- `tranchePositionReserves(address tranche, bytes32 positionKey) view returns (uint256)`
- `transferOwnership(address newOwner)`
- `unpause()`
- `virtualPoolValue() view returns (uint256)`
- `withdrawFee(address _token, address _recipient)`

Not on BNB Chain's liquidityPool (`0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874`), whose code does not dispatch them or declares them otherwise: `accrueInterest`, `addToken`, `borrowIndices`, `canSwap`, `daoFee`, `delistToken`, `feeReserves`, `getAllAssets`, `getAllTranches`, `globalShortSize`, `interestRate`, `interestRateModel`, `isValidLeverageTokenPair`, `lastAccrualTimestamps`, `liquidatePositionAllowed`, `liquidationFee`, `liquidityCalculator`, `pause`, `paused`, `poolBalances`, `positionFee`, `positionRevisions`, `reinit_setFeeDiscount`, `setController`, `setDaoFee`, `setFeeDistributor`, `setInterestRateModel`, `setLiquidityCalculator`, `setMaxLeverage`, `setOracle`, `setOrderManager`, `setPoolHook`, `setPositionFee`, `setRiskFactor`, `unpause`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error AddLiquidityNotAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DuplicateToken` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientPoolAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidInterval` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidLeverage` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMaxLeverage` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPositionSize` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTranche` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxGlobalShortSizeExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxNumberOfTranchesReached` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotApplicableForStableCoin` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Overflow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RemoveLiquidityTooMuch` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReserveReduceTooMuch` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TrancheAlreadyAdded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event InterestRateSet` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event MaintenanceMarginChanged` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event TrancheAdded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
