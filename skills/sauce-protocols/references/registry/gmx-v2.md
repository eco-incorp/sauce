<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V2 (`gmx-v2`)

Next generation of GMX perpetual exchange with isolated markets, improved risk management, and GM liquidity tokens replacing GLP.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | `Gmx`: `gmx-v1`, `gmx-v2` |
| Namespace | `GmxV2` on arbitrum |
| Chains | arbitrum |
| Document | [gmx-v2.md](../gmx-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `GmxV2` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's dataStore, `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8`.
  require(GmxV2.DataStore != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | dataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | `GmxV2.DataStore` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `GmxV2.ExchangeRouter` |

## ABI

### `ExchangeRouterABI`

`import ExchangeRouterABI from "./protocols/gmx-v2/ExchangeRouterABI.json";` Speaks for: exchangeRouter. The import is the contract's full ABI across every deployment; call it through the `GmxV2` namespace to have a function a chain's deployment does not run refused.

- `cancelDeposit(bytes32 key) payable`
- `cancelOrder(bytes32 key) payable`
- `cancelShift(bytes32 key) payable`
- `cancelWithdrawal(bytes32 key) payable`
- `claimAffiliateRewards(address[] markets, address[] tokens, address receiver) payable returns (uint256[])`
- `claimCollateral(address[] markets, address[] tokens, uint256[] timeKeys, address receiver) payable returns (uint256[])`
- `claimFundingFees(address[] markets, address[] tokens, address receiver) payable returns (uint256[])`
- `claimUiFees(address[] markets, address[] tokens, address receiver) payable returns (uint256[])`
- `createDeposit(((address receiver, address callbackContract, address uiFeeReceiver, address market, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minMarketTokens, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)`
- `createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params) payable returns (bytes32 orderKey)`
- `createShift(((address receiver, address callbackContract, address uiFeeReceiver, address fromMarket, address toMarket) addresses, uint256 minMarketTokens, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)`
- `createTwapOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params, uint256 twapCount, uint256 interval) payable returns (bytes32[] orderKeys)`
- `createWithdrawal(((address receiver, address callbackContract, address uiFeeReceiver, address market, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)`
- `dataStore() view returns (address)`
- `depositHandler() view returns (address)`
- `eventEmitter() view returns (address)`
- `executeAtomicWithdrawal(((address receiver, address callbackContract, address uiFeeReceiver, address market, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params, (address[] tokens, address[] providers, bytes[] data) oracleParams) payable`
- `externalHandler() view returns (address)`
- `jitOrderHandler() view returns (address)`
- `makeExternalCalls(address[] externalCallTargets, bytes[] externalCallDataList, address[] refundTokens, address[] refundReceivers) payable`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `orderHandler() view returns (address)`
- `roleStore() view returns (address)`
- `router() view returns (address)`
- `sendNativeToken(address receiver, uint256 amount) payable`
- `sendTokens(address token, address receiver, uint256 amount) payable`
- `sendWnt(address receiver, uint256 amount) payable`
- `setSavedCallbackContract(address market, address callbackContract) payable`
- `setUiFeeFactor(uint256 uiFeeFactor) payable`
- `shiftHandler() view returns (address)`
- `updateOrder(bytes32 key, uint256 sizeDeltaUsd, uint256 acceptablePrice, uint256 triggerPrice, uint256 minOutputAmount, uint256 validFromTime, bool autoCancel) payable`
- `withdrawalHandler() view returns (address)`
