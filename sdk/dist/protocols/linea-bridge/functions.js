export const bridgeETH = `
import { LineaL1MessageServiceABI as IL1MessageService } from "./abis";

function main(messageServiceAddress: Address, recipient: Address, fee: Uint256): Uint256 {
  const service = IL1MessageService.at(messageServiceAddress);
  service.sendMessage(recipient, fee, 0x00);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map