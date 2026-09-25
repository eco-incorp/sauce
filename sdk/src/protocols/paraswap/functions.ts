export const simpleSwap = `
import { AugustusV5ABI as IAugustus } from "./abis";

function main(augustusAddress: Address, fromToken: Address, toToken: Address, fromAmount: Uint256, toAmount: Uint256, expectedAmount: Uint256, beneficiary: Address, deadline: Uint256): Uint256 {
  const augustus = IAugustus.at(augustusAddress);
  return augustus.simpleSwap({
    fromToken: fromToken,
    toToken: toToken,
    fromAmount: fromAmount,
    toAmount: toAmount,
    expectedAmount: expectedAmount,
    callees: [],
    exchangeData: "",
    startIndexes: [],
    values: [],
    beneficiary: beneficiary,
    partner: 0x0000000000000000000000000000000000000000,
    feePercent: 0,
    permit: "",
    deadline: deadline,
    uuid: 0
  });
}
`;
