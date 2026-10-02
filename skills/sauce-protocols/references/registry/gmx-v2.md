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

`import ExchangeRouterABI from "./protocols/gmx-v2/ExchangeRouterABI.json";` Speaks for: exchangeRouter.

- `createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params) payable returns (bytes32 orderKey)`
- `cancelOrder(bytes32 key) payable`
- `sendTokens(address token, address receiver, uint256 amount) payable`
