<!-- Generated from the SDK's registries. Do not edit. -->

# MUX Protocol (`mux-protocol`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> MUX Protocol is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs with shared liquidity pool.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `MuxProtocol` on arbitrum |
| Chains | arbitrum |

## What it offers

- **addLiquidity**: Place an order adding liquidity to the MUX pool (receive MLP tokens)
- **removeLiquidity**: Place an order removing liquidity (burn MLP tokens)
- **placePositionOrder3**: Place a leveraged position order
- **cancelOrder**: Cancel a pending order

## Notes

- Aggregates perpetual DEXs (GMX, Gains, etc.)
- subAccountId (bytes32) encodes: account address + collateral token ID + asset ID + isLong flag
- tokenId is a uint8 index identifying the collateral asset (0=ETH, 1=BTC, etc.)
- MLP is the liquidity provider token
- Position orders require ETH execution fee sent as msg.value

## Its names in a program

On Arbitrum One, `MuxProtocol` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's liquidityPool, `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633`.
  require(MuxProtocol.LiquidityPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` | `MuxProtocol.LiquidityPool` |
| [Arbitrum One](../chains/arbitrum.md) | orderBook | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` | `MuxProtocol.OrderBook` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/mux-protocol/LiquidityPoolABI.json";` Speaks for: liquidityPool. The import is the contract's full ABI across every deployment; call it through the `MuxProtocol` namespace to have a function a chain's deployment does not run refused.

- `closePosition(bytes32 subAccountId, uint96 amount, uint8 profitAssetId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice) returns (uint96)`
- `depositCollateral(bytes32 subAccountId, uint256 rawAmount)`
- `getAllAssetInfo() view returns ((bytes32 symbol, address tokenAddress, uint8 id, uint8 decimals, uint56 flags, uint24 _flagsPadding, uint32 initialMarginRate, uint32 maintenanceMarginRate, uint32 minProfitRate, uint32 minProfitTime, uint32 positionFeeRate, address referenceOracle, uint32 referenceDeviation, uint8 referenceOracleType, uint32 halfSpread, uint96 credit, uint128 _reserved2, uint96 collectedFee, uint32 liquidationFeeRate, uint96 spotLiquidity, uint96 maxLongPositionSize, uint96 totalLongPosition, uint96 averageLongPrice, uint96 maxShortPositionSize, uint96 totalShortPosition, uint96 averageShortPrice, address muxTokenAddress, uint32 spotWeight, uint32 longFundingBaseRate8H, uint32 longFundingLimitRate8H, uint128 longCumulativeFundingRate, uint128 shortCumulativeFunding)[])`
- `getAssetAddress(uint8 assetId) view returns (address)`
- `getAssetInfo(uint8 assetId) view returns ((bytes32 symbol, address tokenAddress, uint8 id, uint8 decimals, uint56 flags, uint24 _flagsPadding, uint32 initialMarginRate, uint32 maintenanceMarginRate, uint32 minProfitRate, uint32 minProfitTime, uint32 positionFeeRate, address referenceOracle, uint32 referenceDeviation, uint8 referenceOracleType, uint32 halfSpread, uint96 credit, uint128 _reserved2, uint96 collectedFee, uint32 liquidationFeeRate, uint96 spotLiquidity, uint96 maxLongPositionSize, uint96 totalLongPosition, uint96 averageLongPrice, uint96 maxShortPositionSize, uint96 totalShortPosition, uint96 averageShortPrice, address muxTokenAddress, uint32 spotWeight, uint32 longFundingBaseRate8H, uint32 longFundingLimitRate8H, uint128 longCumulativeFundingRate, uint128 shortCumulativeFunding))`
- `getLiquidityPoolStorage() view returns (uint32[8] u32s, uint96[2] u96s)`
- `getSubAccount(bytes32 subAccountId) view returns (uint96 collateral, uint96 size, uint32 lastIncreasedTime, uint96 entryPrice, uint128 entryFunding)`
- `initialize(address nextHop, address mlp, address orderBook, address weth, address nativeUnwrapper, address vault)`
- `liquidate(bytes32 subAccountId, uint8 profitAssetId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice) returns (uint96)`
- `openPosition(bytes32 subAccountId, uint96 amount, uint96 collateralPrice, uint96 assetPrice) returns (uint96)`
- `owner() view returns (address)`
- `renounceOwnership()`
- `takeOwnership()`
- `transferOwnership(address newOwner)`
- `upgradeChainedProxy(address nextHop)`
- `withdrawAllCollateral(bytes32 subAccountId)`
- `withdrawCollateral(bytes32 subAccountId, uint256 rawAmount, uint96 collateralPrice, uint96 assetPrice)`
- `withdrawProfit(bytes32 subAccountId, uint256 rawAmount, uint8 profitAssetId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice)`

Left out of this ABI, though its deployments declare them:

- `event AddAsset` taking `(uint8,bytes32,uint8,bool,address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AddLiquidity` taking `(address,uint8,uint96,uint96,uint96,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BorrowAsset` taking `(uint8,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ClaimBrokerGasRebate` taking `(address,uint32,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Rebalance` taking `(address,uint8,uint8,uint96,uint96,uint96,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RedeemMuxToken` taking `(address,uint8,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RemoveLiquidity` taking `(address,uint8,uint96,uint96,uint96,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RepayAsset` taking `(uint8,address,address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetAssetFlags` taking `(uint8,uint56,uint32,uint96,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetAssetParams` taking `(uint8,bytes32,uint32,uint32,uint32,uint32,uint32,uint32,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetBrokerGasRebate` taking `(uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetFundingInterval` taking `(uint32,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetFundingParams` taking `(uint8,uint32,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetLiquidityFee` taking `(uint32,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetLiquidityManager` taking `(address,bool)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetMaintainer` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetMlpPriceRange` taking `(uint96,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetReferenceOracle` taking `(uint8,uint8,address,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetStrictStableDeviation` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event TransferLiquidity` taking `(address,address,uint8,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event UpdateFundingRate` taking `(uint8,uint32,uint128,uint32,uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event WithdrawCollectedFee` taking `(uint8,uint96)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `OrderBookABI`

`import OrderBookABI from "./protocols/mux-protocol/OrderBookABI.json";` Speaks for: orderBook. The import is the contract's full ABI across every deployment; call it through the `MuxProtocol` namespace to have a function a chain's deployment does not run refused.

- `addBroker(address newBroker)`
- `addRebalancer(address newRebalancer)`
- `brokers(address broker) view returns (bool)`
- `cancelCoolDown() view returns (uint32)`
- `cancelOrder(uint64 orderId)`
- `claimBrokerGasRebate() returns (uint256 rawAmount)`
- `collectFundingFee(bytes32 subAccountId, uint96 collateralPrice, uint96 assetPrice)`
- `depositCollateral(bytes32 subAccountId, uint256 collateralAmount) payable`
- `fillLiquidityOrder(uint64 orderId, uint96 assetPrice, uint96 mlpPrice, uint96 currentAssetValue, uint96 targetAssetValue)`
- `fillPositionOrder(uint64 orderId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice)`
- `fillRebalanceOrder(uint64 orderId, uint96 price0, uint96 price1)`
- `fillWithdrawalOrder(uint64 orderId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice)`
- `getOrder(uint64 orderId) view returns (bytes32[3], bool)`
- `getOrderCount() view returns (uint256)`
- `getOrders(uint256 begin, uint256 end) view returns (bytes32[3][] orderArray, uint256 totalCount)`
- `initialize(address pool, address mlp, address weth, address nativeUnwrapper)`
- `isLiquidityOrderPaused() view returns (bool)`
- `isPositionOrderPaused() view returns (bool)`
- `liquidate(bytes32 subAccountId, uint8 profitAssetId, uint96 collateralPrice, uint96 assetPrice, uint96 profitAssetPrice)`
- `liquidityLockPeriod() view returns (uint32)`
- `maintainer() view returns (address)`
- `marketOrderTimeout() view returns (uint32)`
- `maxLimitOrderTimeout() view returns (uint32)`
- `nextOrderId() view returns (uint64)`
- `owner() view returns (address)`
- `pause(bool isPositionOrderPaused_, bool isLiquidityOrderPaused_)`
- `placeLiquidityOrder(uint8 assetId, uint96 rawAmount, bool isAdding) payable`
- `placePositionOrder3(bytes32 subAccountId, uint96 collateralAmount, uint96 size, uint96 price, uint8 profitTokenId, uint8 flags, uint32 deadline, bytes32 referralCode, (uint96 tpPrice, uint96 slPrice, uint8 tpslProfitTokenId, uint32 tpslDeadline) extra) payable`
- `placeRebalanceOrder(uint8 tokenId0, uint8 tokenId1, uint96 rawAmount0, uint96 maxRawAmount1, bytes32 userData)`
- `placeWithdrawalOrder(bytes32 subAccountId, uint96 rawAmount, uint8 profitTokenId, bool isProfit)`
- `positionOrderExtras(uint64 orderId) view returns ((uint96 tpPrice, uint96 slPrice, uint8 tpslProfitTokenId, uint32 tpslDeadline))`
- `rebalancers(address rebalancer) view returns (bool)`
- `redeemMuxToken(uint8 tokenId, uint96 muxTokenAmount)`
- `referralManager() view returns (address)`
- `removeBroker(address broker)`
- `removeRebalancer(address rebalancer)`
- `renounceBroker()`
- `renounceOwnership()`
- `renounceRebalancer()`
- `setAggregator(address aggregatorAddress, bool isEnable)`
- `setCallbackGasLimit(uint256 gasLimit)`
- `setCallbackWhitelist(address caller, bool enable)`
- `setLiquidityLockPeriod(uint32 newLiquidityLockPeriod)`
- `setLotSize(uint8 assetId, uint96 lotSize)`
- `setMaintainer(address newMaintainer)`
- `setOrderTimeout(uint32 marketOrderTimeout_, uint32 maxLimitOrderTimeout_, uint32 cancelCoolDown_)`
- `setReferralManager(address newReferralManager)`
- `takeOwnership()`
- `transferOwnership(address newOwner)`
- `updateFundingState(uint32 stableUtilization, uint8[] unstableTokenIds, uint32[] unstableUtilizations, uint96[] unstablePrices)`
- `withdrawAllCollateral(bytes32 subAccountId)`

Left out of this ABI, though its deployments declare them:

- `event NewPositionOrder` taking `(bytes32,uint64,uint96,uint96,uint96,uint8,uint8,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
