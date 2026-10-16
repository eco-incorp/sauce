<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V2 (`gmx-v2`)

> GMX V2 is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Next generation of GMX perpetual exchange with isolated markets, improved risk management, and GM liquidity tokens replacing GLP.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | `Gmx`: `gmx-v1`, `gmx-v2` |
| Namespace | `GmxV2` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **createOrder**: Create a market/limit order for trading (complex tuple params)
- **sendTokens**: Send tokens via ExchangeRouter (used before creating orders)
- **cancelOrder**: Cancel a pending order by key

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Create a market order
import { ExchangeRouterABI as IExchangeRouter } from "./abis";
function main(
  exchangeRouterAddress: Address,
  receiver: Address,
  cancellationReceiver: Address,
  market: Address,
  initialCollateralToken: Address,
  sizeDeltaUsd: Uint256,
  initialCollateralDeltaAmount: Uint256,
  triggerPrice: Uint256,
  acceptablePrice: Uint256,
  executionFee: Uint256,
  minOutputAmount: Uint256,
  orderType: Uint256,
  isLong: bool,
): Uint256 {
  const router = IExchangeRouter.at(exchangeRouterAddress);
  const result = router.createOrder({
    addresses: {
      receiver: receiver,
      cancellationReceiver: cancellationReceiver,
      callbackContract: 0x0000000000000000000000000000000000000000,
      uiFeeReceiver: 0x0000000000000000000000000000000000000000,
      market: market,
      initialCollateralToken: initialCollateralToken,
      swapPath: [],
    },
    numbers: {
      sizeDeltaUsd: sizeDeltaUsd,
      initialCollateralDeltaAmount: initialCollateralDeltaAmount,
      triggerPrice: triggerPrice,
      acceptablePrice: acceptablePrice,
      executionFee: executionFee,
      callbackGasLimit: 0,
      minOutputAmount: minOutputAmount,
      validFromTime: 0,
    },
    orderType: orderType,
    decreasePositionSwapType: 0,
    isLong: isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: 0x0000000000000000000000000000000000000000000000000000000000000000,
    dataList: [],
  });
  return result;
}

// Send tokens to market vault before creating order
import { ExchangeRouterABI as IExchangeRouter } from "./abis";
function main(
  exchangeRouterAddress: Address,
  token: Address,
  receiver: Address,
  amount: Uint256,
): Uint256 {
  const router = IExchangeRouter.at(exchangeRouterAddress);
  router.sendTokens(token, receiver, amount);
  return 1;
}

// Cancel pending order
import { ExchangeRouterABI as IExchangeRouter } from "./abis";
function main(exchangeRouterAddress: Address, orderKey: Uint256): Uint256 {
  const router = IExchangeRouter.at(exchangeRouterAddress);
  router.cancelOrder(orderKey);
  return 1;
}
```

## Notes

- TVL: $800M+. Isolated markets with separate GM tokens per trading pair
- Order flow: 1) sendTokens to market vault, 2) createOrder with execution fee
- GMX redeploys the ExchangeRouter on upgrades and revokes the old one; the listed router is the one RoleStore currently grants CONTROLLER
- executionFee is paid in ETH (msg.value) to cover keeper gas costs
- sizeDeltaUsd is in USD with 30 decimals (1 USD = 1e30)
- Each market has its own address - query dataStore for market info
- **addresses**: { receiver, cancellationReceiver, callbackContract, uiFeeReceiver, market, initialCollateralToken, swapPath[] }
- **numbers**: { sizeDeltaUsd, initialCollateralDeltaAmount, triggerPrice, acceptablePrice, executionFee, callbackGasLimit, minOutputAmount, validFromTime }
- **flags and extras**: orderType, decreasePositionSwapType, isLong, shouldUnwrapNativeToken, autoCancel, referralCode (bytes32), dataList (bytes32[])
- **orderType**: 0=MarketSwap, 1=LimitSwap, 2=MarketIncrease, 3=LimitIncrease, 4=MarketDecrease, 5=LimitDecrease, 6=StopLossDecrease
- **isLong**: true for long, false for short

## Its names in a program

On Arbitrum One, `GmxV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's dataStore, `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8`.
  require(GmxV2.DataStore != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | dataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | `GmxV2.DataStore` |
| [Arbitrum One](../chains/arbitrum.md) | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `GmxV2.ExchangeRouter` |

## ABI

### `ExchangeRouterABI`

`import ExchangeRouterABI from "./protocols/gmx-v2/ExchangeRouterABI.json";` Speaks for: exchangeRouter.

- `createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params) payable returns (bytes32 orderKey)`
- `cancelOrder(bytes32 key) payable`
- `sendTokens(address token, address receiver, uint256 amount) payable`
