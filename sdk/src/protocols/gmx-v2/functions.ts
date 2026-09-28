export const createOrder = `
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
  isLong: bool
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
      swapPath: []
    },
    numbers: {
      sizeDeltaUsd: sizeDeltaUsd,
      initialCollateralDeltaAmount: initialCollateralDeltaAmount,
      triggerPrice: triggerPrice,
      acceptablePrice: acceptablePrice,
      executionFee: executionFee,
      callbackGasLimit: 0,
      minOutputAmount: minOutputAmount,
      validFromTime: 0
    },
    orderType: orderType,
    decreasePositionSwapType: 0,
    isLong: isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: 0x0000000000000000000000000000000000000000000000000000000000000000,
    dataList: []
  });
  return result;
}
`;

export const sendTokens = `
import { ExchangeRouterABI as IExchangeRouter } from "./abis";

function main(exchangeRouterAddress: Address, token: Address, receiver: Address, amount: Uint256): Uint256 {
  const router = IExchangeRouter.at(exchangeRouterAddress);
  router.sendTokens(token, receiver, amount);
  return 1;
}
`;

export const cancelOrder = `
import { ExchangeRouterABI as IExchangeRouter } from "./abis";

function main(exchangeRouterAddress: Address, orderKey: Uint256): Uint256 {
  const router = IExchangeRouter.at(exchangeRouterAddress);
  router.cancelOrder(orderKey);
  return 1;
}
`;
