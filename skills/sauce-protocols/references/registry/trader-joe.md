<!-- Generated from the SDK's registries. Do not edit. -->

# Trader Joe (`trader-joe`)

Liquidity Book DEX with variable-width bins for concentrated liquidity. Native to Avalanche with expansion to Arbitrum and BSC.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `TraderJoe` on bsc, arbitrum, avalanche |
| Chains | bsc, arbitrum, avalanche |
| Document | [trader-joe.md](../trader-joe.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `TraderJoe` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's lbFactory, `0x8e42f2F4101563bF679975178e880FD87d3eFd4e`.
  require(TraderJoe.LBFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lbFactory | `0x8e42f2F4101563bF679975178e880FD87d3eFd4e` | `TraderJoe.LBFactory`; not on this deployment: `acceptOwnership`, `DEFAULT_ADMIN_ROLE`, `getRoleAdmin`, `grantRole`, `hasRole`, `LB_HOOKS_MANAGER_ROLE`, `removeLBHooksOnPair`, `renounceRole`, `revokeRole`, `setLBHooksParametersOnPair`, `supportsInterface`, `transferOwnership` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `TraderJoe.LBRouter`; not on this deployment: `getFactoryV2_1` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory`; not on this deployment: `becomeOwner`, `revokePendingOwner`, `setPendingOwner` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory`; not on this deployment: `becomeOwner`, `revokePendingOwner`, `setPendingOwner` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `LBFactoryABI`

`import LBFactoryABI from "./protocols/trader-joe/LBFactoryABI.json";` Speaks for: lbFactory. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `TraderJoe` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptOwnership()`
- `addQuoteAsset(address quoteAsset)`
- `becomeOwner()`
- `createLBPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep) returns (address pair)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `forceDecay(address pair)`
- `getAllBinSteps() view returns (uint256[] binStepWithPreset)`
- `getAllLBPairs(address tokenX, address tokenY) view returns ((uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting)[] lbPairsAvailable)`
- `getFeeRecipient() view returns (address feeRecipient)`
- `getFlashLoanFee() view returns (uint256 flashLoanFee)`
- `getLBPairAtIndex(uint256 index) view returns (address lbPair)`
- `getLBPairImplementation() view returns (address lbPairImplementation)`
- `getLBPairInformation(address tokenA, address tokenB, uint256 binStep) view returns ((uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting) lbPairInformation)`: `LBPair` is a `TraderJoe.LBPair`
- `getMaxFlashLoanFee() pure returns (uint256 maxFee)`
- `getMinBinStep() pure returns (uint256 minBinStep)`
- `getNumberOfLBPairs() view returns (uint256 lbPairNumber)`
- `getNumberOfQuoteAssets() view returns (uint256 numberOfQuoteAssets)`
- `getOpenBinSteps() view returns (uint256[] openBinStep)`
- `getPreset(uint256 binStep) view returns (uint256 baseFactor, uint256 filterPeriod, uint256 decayPeriod, uint256 reductionFactor, uint256 variableFeeControl, uint256 protocolShare, uint256 maxVolatilityAccumulator, bool isOpen)`
- `getQuoteAssetAtIndex(uint256 index) view returns (address asset)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `isQuoteAsset(address token) view returns (bool isQuote)`
- `LB_HOOKS_MANAGER_ROLE() view returns (bytes32)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `removeLBHooksOnPair(address tokenX, address tokenY, uint16 binStep)`
- `removePreset(uint16 binStep)`
- `removeQuoteAsset(address quoteAsset)`
- `renounceOwnership()`
- `renounceRole(bytes32 role, address callerConfirmation)`
- `revokePendingOwner()`
- `revokeRole(bytes32 role, address account)`
- `setFeeRecipient(address feeRecipient)`
- `setFeesParametersOnPair(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator)`
- `setFlashLoanFee(uint256 flashLoanFee)`
- `setLBHooksParametersOnPair(address tokenX, address tokenY, uint16 binStep, bytes32 hooksParameters, bytes onHooksSetData)`
- `setLBPairIgnored(address tokenX, address tokenY, uint16 binStep, bool ignored)`
- `setLBPairImplementation(address newLBPairImplementation)`
- `setPendingOwner(address pendingOwner_)`
- `setPreset(uint16 binStep, uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator, bool isOpen)`
- `setPresetOpenState(uint16 binStep, bool isOpen)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `transferOwnership(address newOwner)`

Not on BNB Chain's lbFactory (`0x8e42f2F4101563bF679975178e880FD87d3eFd4e`), whose code does not dispatch them or does not declare them as listed here: `acceptOwnership`, `DEFAULT_ADMIN_ROLE`, `getRoleAdmin`, `grantRole`, `hasRole`, `LB_HOOKS_MANAGER_ROLE`, `removeLBHooksOnPair`, `renounceRole`, `revokeRole`, `setLBHooksParametersOnPair`, `supportsInterface`, `transferOwnership`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's lbFactory (`0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c`), whose code does not dispatch them or does not declare them as listed here: `becomeOwner`, `revokePendingOwner`, `setPendingOwner`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's lbFactory (`0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c`), whose code does not dispatch them or does not declare them as listed here: `becomeOwner`, `revokePendingOwner`, `setPendingOwner`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error AccessControlBadConfirmation` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EnumerableMapNonexistentKey` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__AddressZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__BinStepHasNoPreset` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__CannotGrantDefaultAdminRole` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__ImplementationNotSet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__LBPairDoesNotExist` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__LBPairIgnoredIsAlreadyInTheSameState` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__LBPairSafetyCheckFailed` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__PresetIsLockedForUsers` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__PresetOpenStateIsAlreadyInTheSameState` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__SameFlashLoanFee` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__SameHooksImplementation` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBFactory__SameImplementation` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OwnableInvalidOwner` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PendingOwnable__NotPendingOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Uint128x128Math__PowUnderflow` taking `(uint256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `LBPairABI`

`import LBPairABI from "./protocols/trader-joe/LBPairABI.json";`

- `approveForAll(address spender, bool approved)`
- `balanceOf(address account, uint256 id) view returns (uint256)`
- `balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[] batchBalances)`
- `batchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts)`
- `burn(address from, address to, uint256[] ids, uint256[] amountsToBurn) returns (bytes32[] amounts)`
- `collectProtocolFees() returns (bytes32 collectedProtocolFees)`
- `flashLoan(address receiver, bytes32 amounts, bytes data)`
- `forceDecay()`
- `getActiveId() view returns (uint24 activeId)`
- `getBin(uint24 id) view returns (uint128 binReserveX, uint128 binReserveY)`
- `getBinStep() pure returns (uint16)`
- `getFactory() view returns (address factory)`
- `getIdFromPrice(uint256 price) pure returns (uint24 id)`
- `getLBHooksParameters() view returns (bytes32)`
- `getNextNonEmptyBin(bool swapForY, uint24 id) view returns (uint24 nextId)`
- `getOracleParameters() view returns (uint8 sampleLifetime, uint16 size, uint16 activeSize, uint40 lastUpdated, uint40 firstTimestamp)`
- `getOracleSampleAt(uint40 lookupTimestamp) view returns (uint64 cumulativeId, uint64 cumulativeVolatility, uint64 cumulativeBinCrossed)`
- `getPriceFromId(uint24 id) pure returns (uint256 price)`
- `getProtocolFees() view returns (uint128 protocolFeeX, uint128 protocolFeeY)`
- `getReserves() view returns (uint128 reserveX, uint128 reserveY)`
- `getStaticFeeParameters() view returns (uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator)`
- `getSwapIn(uint128 amountOut, bool swapForY) view returns (uint128 amountIn, uint128 amountOutLeft, uint128 fee)`
- `getSwapOut(uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)`
- `getTokenX() pure returns (address tokenX)`: the address is a token
- `getTokenY() pure returns (address tokenY)`: the address is a token
- `getVariableFeeParameters() view returns (uint24 volatilityAccumulator, uint24 volatilityReference, uint24 idReference, uint40 timeOfLastUpdate)`
- `implementation() view returns (address)`
- `increaseOracleLength(uint16 newLength)`
- `initialize(uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator, uint24 activeId)`
- `isApprovedForAll(address owner, address spender) view returns (bool)`
- `mint(address to, bytes32[] liquidityConfigs, address refundTo) returns (bytes32 amountsReceived, bytes32 amountsLeft, uint256[] liquidityMinted)`
- `name() view returns (string)`
- `setHooksParameters(bytes32 hooksParameters, bytes onHooksSetData)`
- `setStaticFeeParameters(uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator)`
- `swap(bool swapForY, address to) returns (bytes32 amountsOut)`
- `symbol() view returns (string)`
- `totalSupply(uint256 id) view returns (uint256)`

Not every contract reached through this interface runs every function listed: the contracts the registry checked it against do not all dispatch the same ones. A call to one the contract does not run does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error AddressHelper__CallFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AddressHelper__NonContract` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BinHelper__CompositionFactorFlawed` taking `(uint24)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__AddressZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__FlashLoanInsufficientAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__InsufficientAmountOut` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__InvalidStaticFeeParameters` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__MaxTotalFeeExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__OnlyProtocolFeeRecipient` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__OutOfLiquidity` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__TokenNotSupported` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__ZeroBorrowAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBPair__ZeroShares` taking `(uint24)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBToken__AddressThisOrZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBToken__BurnExceedsBalance` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBToken__InvalidLength` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LiquidityConfigurations__InvalidConfig` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInitializing` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OracleHelper__LookUpTimestampTooOld` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OracleHelper__NewLengthTooSmall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PackedUint128Math__MultiplierTooLarge` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReentrancyGuard__ReentrantCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeCast__Exceeds128Bits` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeCast__Exceeds40Bits` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TokenHelper__TransferFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Uint128x128Math__LogUnderflow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Uint128x128Math__PowUnderflow` taking `(uint256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `LBRouterABI`

`import LBRouterABI from "./protocols/trader-joe/LBRouterABI.json";` Speaks for: lbRouter. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `TraderJoe` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addLiquidity((address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline) liquidityParameters) returns (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)`
- `addLiquidityNATIVE((address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline) liquidityParameters) payable returns (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)`
- `createLBPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep) returns (address pair)`
- `getFactory() view returns (address lbFactory)`
- `getFactoryV2_1() view returns (address lbFactory)`
- `getIdFromPrice(address pair, uint256 price) view returns (uint24)`
- `getLegacyFactory() view returns (address legacyLBfactory)`
- `getLegacyRouter() view returns (address legacyRouter)`
- `getPriceFromId(address pair, uint24 id) view returns (uint256)`
- `getSwapIn(address pair, uint128 amountOut, bool swapForY) view returns (uint128 amountIn, uint128 amountOutLeft, uint128 fee)`
- `getSwapOut(address pair, uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)`
- `getV1Factory() view returns (address factoryV1)`
- `getWNATIVE() view returns (address wnative)`
- `removeLiquidity(address tokenX, address tokenY, uint16 binStep, uint256 amountXMin, uint256 amountYMin, uint256[] ids, uint256[] amounts, address to, uint256 deadline) returns (uint256 amountX, uint256 amountY)`
- `removeLiquidityNATIVE(address token, uint16 binStep, uint256 amountTokenMin, uint256 amountNATIVEMin, uint256[] ids, uint256[] amounts, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountNATIVE)`
- `swapExactNATIVEForTokens(uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) payable returns (uint256 amountOut)`
- `swapExactNATIVEForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) payable returns (uint256 amountOut)`
- `swapExactTokensForNATIVE(uint256 amountIn, uint256 amountOutMinNATIVE, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapExactTokensForNATIVESupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMinNATIVE, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapNATIVEForExactTokens(uint256 amountOut, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) payable returns (uint256[] amountsIn)`
- `swapTokensForExactNATIVE(uint256 amountNATIVEOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256[] amountsIn)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256[] amountsIn)`
- `sweep(address token, address to, uint256 amount)`
- `sweepLBToken(address lbToken, address to, uint256[] ids, uint256[] amounts)`

Not on BNB Chain's lbRouter (`0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30`), whose code does not dispatch them or does not declare them as listed here: `getFactoryV2_1`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error AddressHelper__CallFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AddressHelper__NonContract` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__AmountSlippageBPTooBig` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__AmountSlippageCaught` taking `(uint256,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__BinReserveOverflows` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__BrokenSwapSafetyCheck` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__FailedToSendNATIVE` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__IdDesiredOverflows` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__IdOverflows` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__IdSlippageCaught` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__InsufficientAmountOut` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__InvalidVersion` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__MaxAmountInExceeded` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__NotFactoryOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__PairNotCreated` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__SwapOverflows` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__TooMuchTokensIn` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LBRouter__WrongAmounts` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TokenHelper__TransferFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
