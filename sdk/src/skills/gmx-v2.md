# GMX V2

Next generation of GMX perpetual exchange with isolated markets, improved risk management, and GM liquidity tokens replacing GLP.

## Category

perpetuals | Chains: Arbitrum

## Key Operations

- **createOrder**: Create a market/limit order for trading (complex tuple params)
- **sendTokens**: Send tokens via ExchangeRouter (used before creating orders)
- **cancelOrder**: Cancel a pending order by key

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/gmx-v2";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Arbitrum | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` |
| Arbitrum | dataStore      | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` |

## ABI Methods

### ExchangeRouterABI

- `createOrder(tuple)` - Create order. Returns order key (bytes32). See CreateOrderParams struct below
- `cancelOrder(bytes32)` - Cancel pending order by key
- `sendTokens(address,address,uint256)` - Send tokens to vault. Must be called before createOrder

### CreateOrderParams Struct

- **addresses**: { receiver, cancellationReceiver, callbackContract, uiFeeReceiver, market, initialCollateralToken, swapPath[] }
- **numbers**: { sizeDeltaUsd, initialCollateralDeltaAmount, triggerPrice, acceptablePrice, executionFee, callbackGasLimit, minOutputAmount, validFromTime }
- **flags and extras**: orderType, decreasePositionSwapType, isLong, shouldUnwrapNativeToken, autoCancel, referralCode (bytes32), dataList (bytes32[])
- **orderType**: 0=MarketSwap, 1=LimitSwap, 2=MarketIncrease, 3=LimitIncrease, 4=MarketDecrease, 5=LimitDecrease, 6=StopLossDecrease
- **isLong**: true for long, false for short

## Notes

- TVL: $800M+. Isolated markets with separate GM tokens per trading pair
- Order flow: 1) sendTokens to market vault, 2) createOrder with execution fee
- GMX redeploys the ExchangeRouter on upgrades and revokes the old one; the listed router is the one RoleStore currently grants CONTROLLER
- executionFee is paid in ETH (msg.value) to cover keeper gas costs
- sizeDeltaUsd is in USD with 30 decimals (1 USD = 1e30)
- Each market has its own address - query dataStore for market info
