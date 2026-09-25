export const unoswap = `
import { AggregationRouterV6ABI as IAggregationRouterV6 } from "./abis";

function main(routerAddress: Address, srcToken: Address, amount: Uint256, minReturn: Uint256): Uint256 {
  const router = IAggregationRouterV6.at(routerAddress);
  return router.unoswap(srcToken, amount, minReturn, []);
}
`;
