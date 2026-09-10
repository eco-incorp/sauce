export const supply = `
import { MorphoABI as IMorpho } from "./abis";

function main(morphoAddress: Address, loanToken: Address, collateralToken: Address, oracle: Address, irm: Address, lltv: Uint256, amount: Uint256, onBehalf: Address): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.supply({loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv}, amount, 0, onBehalf, "");
  return 1;
}
`;

export const withdraw = `
import { MorphoABI as IMorpho } from "./abis";

function main(morphoAddress: Address, loanToken: Address, collateralToken: Address, oracle: Address, irm: Address, lltv: Uint256, amount: Uint256, onBehalf: Address, receiver: Address): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.withdraw({loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv}, amount, 0, onBehalf, receiver);
  return 1;
}
`;

export const borrow = `
import { MorphoABI as IMorpho } from "./abis";

function main(morphoAddress: Address, loanToken: Address, collateralToken: Address, oracle: Address, irm: Address, lltv: Uint256, amount: Uint256, onBehalf: Address, receiver: Address): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.borrow({loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv}, amount, 0, onBehalf, receiver);
  return 1;
}
`;

export const repay = `
import { MorphoABI as IMorpho } from "./abis";

function main(morphoAddress: Address, loanToken: Address, collateralToken: Address, oracle: Address, irm: Address, lltv: Uint256, amount: Uint256, onBehalf: Address): Uint256 {
  const morpho = IMorpho.at(morphoAddress);
  morpho.repay({loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv}, amount, 0, onBehalf, "");
  return 1;
}
`;
