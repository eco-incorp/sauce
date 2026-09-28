export const openPosition = `
import { PositionRouterABI as IPositionRouter } from "./abis";

function main(positionRouterAddress: Address, path: Address[], indexToken: Address, amountIn: Uint256, sizeDelta: Uint256, isLong: bool): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createIncreasePosition(path, indexToken, amountIn, 0, sizeDelta, isLong, 0, 200000000000000, 0x0000000000000000000000000000000000000000000000000000000000000000, 0x0000000000000000000000000000000000000000);
  return 1;
}
`;

export const closePosition = `
import { PositionRouterABI as IPositionRouter } from "./abis";

function main(positionRouterAddress: Address, path: Address[], indexToken: Address, collateralDelta: Uint256, sizeDelta: Uint256, isLong: bool, receiver: Address): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createDecreasePosition(path, indexToken, collateralDelta, sizeDelta, isLong, receiver, 0, 0, 200000000000000, false, 0x0000000000000000000000000000000000000000);
  return 1;
}
`;

export const swap = `
import { RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, path: Address[], amountIn: Uint256, minOut: Uint256, receiver: Address): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swap(path, amountIn, minOut, receiver);
  return 1;
}
`;
