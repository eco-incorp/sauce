export const burnSqueeth = `
import { ControllerABI as IController } from "./abis";

function main(controllerAddress: Address, vaultId: Uint256, amount: Uint256, withdrawAmount: Uint256): Uint256 {
  const controller = IController.at(controllerAddress);
  controller.burnPowerPerpAmount(vaultId, amount, withdrawAmount);
  return 1;
}
`;

export const withdrawCollateral = `
import { ControllerABI as IController } from "./abis";

function main(controllerAddress: Address, vaultId: Uint256, amount: Uint256): Uint256 {
  const controller = IController.at(controllerAddress);
  controller.withdraw(vaultId, amount);
  return 1;
}
`;
