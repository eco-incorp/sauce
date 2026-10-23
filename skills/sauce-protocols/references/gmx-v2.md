# GMX V2

Next generation of GMX perpetual exchange with isolated markets and GM liquidity tokens replacing GLP.

## Category

perpetuals | Chains and addresses: [registry/gmx-v2.md](registry/gmx-v2.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gmx-v2.md](registry/gmx-v2.md).

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
