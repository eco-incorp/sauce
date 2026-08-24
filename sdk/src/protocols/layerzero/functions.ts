export const sendMessage = `
import { LayerZeroEndpointV2ABI as IEndpointV2 } from "./abis";

function main(endpointAddress: Address, dstEid: Uint256, receiver: Bytes32, message: Bytes): Uint256 {
  const endpoint = IEndpointV2.at(endpointAddress);
  return endpoint.send({dstEid: dstEid, receiver: receiver, message: message, options: 0x00, payInLzToken: false}, ctx.msgSender());
}
`;
