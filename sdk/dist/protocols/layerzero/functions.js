export const sendMessage = `
import { LayerZeroEndpointV2ABI as IEndpointV2 } from "./abis";

function main(endpointAddress: Address, dstEid: Uint256, receiver: Uint256, message: bytes): { guid: Uint256, nonce: Uint256, fee: { nativeFee: Uint256, lzTokenFee: Uint256 } } {
  const endpoint = IEndpointV2.at(endpointAddress);
  return endpoint.send({dstEid: dstEid, receiver: receiver, message: message, options: 0x00, payInLzToken: false}, ctx.msgSender());
}
`;
//# sourceMappingURL=functions.js.map