export const quoteDispatch = `
import { MetalayerRouterABI as IMetalayerRouter } from "./abis";

function main(routerAddress: Address, destinationDomain: Uint256, recipient: Uint256, message: bytes, metadata: bytes): Uint256 {
  return IMetalayerRouter.at(routerAddress).quoteDispatch(destinationDomain, recipient, message, metadata);
}
`;
export const dispatch = `
function main(routerAddress: Address, destinationDomain: Uint256, recipient: Uint256, message: bytes, gasLimit: Uint256, fee: Uint256): bytes {
  // dispatch(uint32,bytes32,(uint32,address,bytes)[],bytes,uint8,uint256), with no reads, INSTANT finality
  const selector = 0xe8dd7ad7;
  const reads = new Array(0);
  return evm.call(routerAddress, fee, selector.toBytesBe(4).concat(abi.encode(destinationDomain, recipient, reads, message, 0, gasLimit)));
}
`;
