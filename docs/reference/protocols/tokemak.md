<!-- Generated from the SDK's registries. Do not edit. -->

# Tokemak (`tokemak`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Tokemak is a yield vault: deposits are put to work to earn interest. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Tokemak` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit assets into Autopool
- **withdraw**: Withdraw assets from Autopool
- **redeem**: Redeem Autopool shares

## Notes

- Autopools are ERC-4626 vaults. Autopilot automatically rebalances across DeFi venues.

## Its names in a program

On Ethereum, `Tokemak` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's autopoolRegistry, `0x7E5828a3A6Ae75426d739E798140513A2E2964E4`.
  require(Tokemak.AutopoolRegistry != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` | `Tokemak.AutopoolRegistry` |
| [Ethereum](../chains/ethereum.md) | systemRegistry | `0x2218F90A98b0C070676f249EF44834686dAa4285` | `Tokemak.SystemRegistry` |
| [Ethereum](../chains/ethereum.md) | toke | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` | `Tokemak.Toke` |

## ABI

### `AutopoolABI`

`import AutopoolABI from "./protocols/tokemak/AutopoolABI.json";`

- `accessController() view returns (address)`
- `addDestinations(address[] destinations)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 value) returns (bool)`
- `asset() view returns (address)`
- `autoPoolStrategy() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `balanceOfActual(address account) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToAssets(uint256 shares, uint256 totalAssetsForPurpose, uint256 supply, uint8 rounding) view returns (uint256 assets)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `convertToShares(uint256 assets, uint256 totalAssetsForPurpose, uint256 supply, uint8 rounding) view returns (uint256 shares)`
- `DEAD_ADDRESS() view returns (address)`
- `decimals() view returns (uint8)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `factory() view returns (address)`
- `FEE_DIVISOR() view returns (uint256)`
- `flashRebalance(address receiver, (address destinationIn, address tokenIn, uint256 amountIn, address destinationOut, address tokenOut, uint256 amountOut) rebalanceParams, bytes data)`
- `getAssetBreakdown() view returns ((uint256 totalIdle, uint256 totalDebt, uint256 totalDebtMin, uint256 totalDebtMax))`
- `getDebtReportingQueue() view returns (address[])`
- `getDestinationInfo(address destVault) view returns ((uint256 cachedDebtValue, uint256 cachedMinDebtValue, uint256 cachedMaxDebtValue, uint256 lastReport, uint256 ownedShares))`
- `getDestinations() view returns (address[])`
- `getFeeSettings() view returns ((address feeSink, uint256 totalAssetsHighMark, uint256 totalAssetsHighMarkTimestamp, uint256 lastPeriodicFeeTake, address periodicFeeSink, uint256 periodicFeeBps, uint256 streamingFeeBps, uint256 navPerShareLastFeeMark, uint256 navPerShareLastFeeMarkTimestamp, bool rebalanceFeeHighWaterMarkEnabled))`
- `getPastRewarders() view returns (address[])`
- `getProfitUnlockSettings() view returns ((uint48 unlockPeriodInSeconds, uint48 fullProfitUnlockTime, uint48 lastProfitUnlockTime, uint256 profitUnlockRate))`
- `getRemovalQueue() view returns (address[])`
- `getSystemRegistry() view returns (address)`
- `getWithdrawalQueue() view returns (address[])`
- `initialize(address strategy, string symbolSuffix, string descPrefix, bytes)`
- `isDestinationQueuedForRemoval(address dest) view returns (bool)`
- `isDestinationRegistered(address destination) view returns (bool)`
- `isPastRewarder(address _pastRewarder) view returns (bool)`
- `isShutdown() view returns (bool)`
- `maxDeposit(address wallet) returns (uint256 maxAssets)`
- `maxMint(address wallet) returns (uint256 maxShares)`
- `maxRedeem(address owner) returns (uint256 maxShares)`
- `maxWithdraw(address owner) returns (uint256 maxAssets)`
- `mint(uint256 shares, address receiver) returns (uint256 assets)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `oldestDebtReporting() view returns (uint256)`
- `ONE() view returns (uint256)`
- `pause()`
- `paused() returns (bool)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets) returns (uint256 shares)`
- `previewMint(uint256 shares) returns (uint256 assets)`
- `previewRedeem(uint256 shares) returns (uint256 assets)`
- `previewWithdraw(uint256 assets) returns (uint256 shares)`
- `recover(address[] tokens, uint256[] amounts, address[] destinations)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `removeDestinations(address[] destinations)`
- `rewarder() view returns (address)`
- `setFeeSink(address newFeeSink)`
- `setPeriodicFeeBps(uint256 fee)`
- `setPeriodicFeeSink(address newPeriodicFeeSink)`
- `setProfitUnlockPeriod(uint48 newUnlockPeriodSeconds)`
- `setRebalanceFeeHighWaterMarkEnabled(bool enabled)`
- `setRewarder(address _rewarder)`
- `setStreamingFeeBps(uint256 fee)`
- `setSymbolAndDescAfterShutdown(string newSymbol, string newName)`
- `shutdown(uint8 reason)`
- `shutdownStatus() view returns (uint8)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalAssets(uint8 purpose) view returns (uint256)`
- `totalSupply() view returns (uint256 shares)`
- `transfer(address to, uint256 value) returns (bool)`
- `transferFrom(address from, address to, uint256 value) returns (bool)`
- `unlockedShares() view returns (uint256 shares)`
- `unpause()`
- `updateDebtReporting(uint256 numToProcess)`
- `vaultType() view returns (bytes32)`
- `WETH_INIT_DEPOSIT() view returns (uint256)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`

Left out of this ABI, though its deployments declare them:

- `error DepositFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC4626DepositExceedsMax` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC4626ExceededMaxRedeem` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ERC4626ExceededMaxWithdraw` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientFundsInDestinations` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDestination` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDestinationVault` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidParams` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidShutdownStatus` taking `(uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidUser` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NavChanged` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NavOpsInProgress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RebalanceDestinationsMatch` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RebalanceFailed` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RegistryItemMissing` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RewarderAlreadySet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UndefinedAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ValueSharesMismatch` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error VaultShutdown` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalIncomplete` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawShareCalcInvalid` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event DestinationDebtReporting` taking `(address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event FeeCollected` taking `(uint256,address,uint256,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event TokensPulled` taking `(address[],uint256[],address[])`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event WithdrawalQueueSet` taking `(address[])`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
