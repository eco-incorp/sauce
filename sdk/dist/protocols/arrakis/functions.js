export const addLiquidity = `
import { ArrakisRouterABI as IArrakisRouter } from "./abis";

function main(routerAddress: Address, vault: Address, receiver: Address, amount0Max: Uint256, amount1Max: Uint256): { amount0: Uint256, amount1: Uint256, sharesReceived: Uint256 } {
  const router = IArrakisRouter.at(routerAddress);
  const result = router.addLiquidity({
    amount0Max: amount0Max,
    amount1Max: amount1Max,
    amount0Min: 0,
    amount1Min: 0,
    amountSharesMin: 0,
    vault: vault,
    receiver: receiver,
    gauge: 0x0000000000000000000000000000000000000000
  });
  return result;
}
`;
export const removeLiquidity = `
import { ArrakisRouterABI as IArrakisRouter } from "./abis";

function main(routerAddress: Address, vault: Address, receiver: Address, burnAmount: Uint256): { amount0: Uint256, amount1: Uint256 } {
  const router = IArrakisRouter.at(routerAddress);
  const result = router.removeLiquidity({
    burnAmount: burnAmount,
    amount0Min: 0,
    amount1Min: 0,
    vault: vault,
    receiver: receiver,
    gauge: 0x0000000000000000000000000000000000000000
  });
  return result;
}
`;
//# sourceMappingURL=functions.js.map