export const swap = `
import { KyberSwapMetaAggregationRouterABI as IMetaAggregationRouter } from "./abis";

function main(routerAddress: Address, callTarget: Address, approveTarget: Address, targetData: bytes, srcToken: Address, dstToken: Address, dstReceiver: Address, amount: Uint256, minReturnAmount: Uint256, clientData: bytes): { returnAmount: Uint256, gasUsed: Uint256 } {
  const router = IMetaAggregationRouter.at(routerAddress);
  return router.swap({callTarget: callTarget, approveTarget: approveTarget, targetData: targetData, desc: {srcToken: srcToken, dstToken: dstToken, srcReceivers: [], srcAmounts: [], feeReceivers: [], feeAmounts: [], dstReceiver: dstReceiver, amount: amount, minReturnAmount: minReturnAmount, flags: 0, permit: ""}, clientData: clientData});
}
`;
