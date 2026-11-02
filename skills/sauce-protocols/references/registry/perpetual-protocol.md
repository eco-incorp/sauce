<!-- Generated from the SDK's registries. Do not edit. -->

# Perpetual Protocol (`perpetual-protocol`)

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `PerpetualProtocol` on optimism |
| Chains | optimism |
| Document | [perpetual-protocol.md](../perpetual-protocol.md): what it is for, how to choose it, its pitfalls |

## In a program

On Optimism, `PerpetualProtocol` is a namespace: its contracts need no import.

```sauce chain=optimism
function main() {
  // Optimism's clearingHouse, `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459`.
  require(PerpetualProtocol.ClearingHouse != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` | `PerpetualProtocol.ClearingHouse` |
| [Optimism](../../../sauce-chains/references/optimism.md) | vault | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` | `PerpetualProtocol.Vault` |

## ABI

### `ClearingHouseABI`

`import ClearingHouseABI from "./protocols/perpetual-protocol/ClearingHouseABI.json";` Speaks for: clearingHouse. The import is the contract's full ABI across every deployment; call it through the `PerpetualProtocol` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity((address baseToken, uint256 base, uint256 quote, int24 lowerTick, int24 upperTick, uint256 minBase, uint256 minQuote, bool useTakerBalance, uint256 deadline) params) returns ((uint256 base, uint256 quote, uint256 fee, uint256 liquidity))`
- `cancelAllExcessOrders(address maker, address baseToken)`
- `cancelExcessOrders(address maker, address baseToken, bytes32[] orderIds)`
- `candidate() view returns (address)`
- `closePosition((address baseToken, uint160 sqrtPriceLimitX96, uint256 oppositeAmountBound, uint256 deadline, bytes32 referralCode) params) returns (uint256 base, uint256 quote)`
- `getAccountBalance() view returns (address)`
- `getAccountValue(address trader) view returns (int256)`
- `getClearingHouseConfig() view returns (address)`
- `getDelegateApproval() view returns (address)`
- `getExchange() view returns (address)`
- `getInsuranceFund() view returns (address)`
- `getOrderBook() view returns (address)`
- `getQuoteToken() view returns (address)`
- `getTrustedForwarder() view returns (address)`
- `getUniswapV3Factory() view returns (address)`
- `getVault() view returns (address)`
- `initialize(address clearingHouseConfigArg, address vaultArg, address quoteTokenArg, address uniV3FactoryArg, address exchangeArg, address accountBalanceArg, address insuranceFundArg)`
- `isTrustedForwarder(address forwarder) view returns (bool)`
- `liquidate(address trader, address baseToken)`
- `liquidate(address trader, address baseToken, int256 positionSize)`
- `openPosition((address baseToken, bool isBaseToQuote, bool isExactInput, uint256 amount, uint256 oppositeAmountBound, uint256 deadline, uint160 sqrtPriceLimitX96, bytes32 referralCode) params) returns (uint256 base, uint256 quote)`
- `openPositionFor(address trader, (address baseToken, bool isBaseToQuote, bool isExactInput, uint256 amount, uint256 oppositeAmountBound, uint256 deadline, uint160 sqrtPriceLimitX96, bytes32 referralCode) params) returns (uint256 base, uint256 quote, uint256 fee)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `quitMarket(address trader, address baseToken) returns (uint256 base, uint256 quote)`
- `removeLiquidity((address baseToken, int24 lowerTick, int24 upperTick, uint128 liquidity, uint256 minBase, uint256 minQuote, uint256 deadline) params) returns ((uint256 base, uint256 quote, uint256 fee))`
- `renounceOwnership()`
- `setDelegateApproval(address delegateApprovalArg)`
- `setOwner(address newOwner)`
- `settleAllFunding(address trader)`
- `uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes data)`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes data)`
- `unpause()`
- `updateOwner()`
- `versionRecipient() pure returns (string)`

### `VaultABI`

`import VaultABI from "./protocols/perpetual-protocol/VaultABI.json";` Speaks for: vault. The import is the contract's full ABI across every deployment; call it through the `PerpetualProtocol` namespace to have a function a chain's deployment does not run refused.

- `candidate() view returns (address)`
- `decimals() view returns (uint8)`
- `deposit(address token, uint256 amount)`
- `depositEther() payable`
- `depositEtherFor(address to) payable`
- `depositFor(address to, address token, uint256 amount)`
- `getAccountBalance() view returns (address)`
- `getAccountValue(address trader) view returns (int256)`
- `getBalance(address trader) view returns (int256)`
- `getBalanceByToken(address trader, address token) view returns (int256)`
- `getClearingHouse() view returns (address)`
- `getClearingHouseConfig() view returns (address)`
- `getCollateralManager() view returns (address)`
- `getCollateralMmRatio() view returns (uint24)`
- `getCollateralTokens(address trader) view returns (address[])`
- `getExchange() view returns (address)`
- `getFreeCollateral(address trader) view returns (uint256)`
- `getFreeCollateralByRatio(address trader, uint24 ratio) view returns (int256)`
- `getFreeCollateralByToken(address trader, address token) view returns (uint256)`
- `getInsuranceFund() view returns (address)`
- `getLiquidatableCollateralBySettlement(address token, uint256 settlementX10_S) view returns (uint256 collateral)`
- `getMarginRequirementForCollateralLiquidation(address trader) view returns (int256)`
- `getMaxRepaidSettlementAndLiquidatableCollateral(address trader, address token) view returns (uint256 maxRepaidSettlementX10_S, uint256 maxLiquidatableCollateral)`
- `getRepaidSettlementByCollateral(address token, uint256 collateral) view returns (uint256 settlementX10_S)`
- `getSettlementToken() view returns (address)`
- `getSettlementTokenValue(address trader) view returns (int256)`
- `getTotalDebt() view returns (uint256)`
- `getTrustedForwarder() view returns (address)`
- `getWETH9() view returns (address)`
- `initialize(address insuranceFundArg, address clearingHouseConfigArg, address accountBalanceArg, address exchangeArg)`
- `isLiquidatable(address trader) view returns (bool)`
- `isTrustedForwarder(address forwarder) view returns (bool)`
- `liquidateCollateral(address trader, address token, uint256 amount, bool isDenominatedInSettlementToken) returns (uint256)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `renounceOwnership()`
- `setClearingHouse(address clearingHouseArg)`
- `setCollateralManager(address collateralManagerArg)`
- `setOwner(address newOwner)`
- `settleBadDebt(address trader)`
- `setTrustedForwarder(address trustedForwarderArg)`
- `setWETH9(address WETH9Arg)`
- `unpause()`
- `updateOwner()`
- `versionRecipient() pure returns (string)`
- `withdraw(address token, uint256 amount)`
- `withdrawAll(address token) returns (uint256 amount)`
- `withdrawAllEther() returns (uint256 amount)`
- `withdrawEther(uint256 amount)`
