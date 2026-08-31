export const swap = `
import { UniswapV4UniversalRouterABI as IUniversalRouter } from "./abis";

function main(routerAddress: Address, commands: bytes, inputs: bytes[]): Uint256 {
  const router = IUniversalRouter.at(routerAddress);
  router.execute(commands, inputs, 99999999999);
  return 1;
}
`;
export const addLiquidity = `
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
`;
export const removeLiquidity = `
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map