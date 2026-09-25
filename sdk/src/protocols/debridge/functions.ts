export const bridge = `
import { DlnSourceABI as IDlnSource } from "./abis";

function main(dlnSourceAddress: Address, giveToken: Address, giveAmount: Uint256, takeToken: bytes, takeAmount: Uint256, takeChainId: Uint256, receiver: bytes): Uint256 {
  const dln = IDlnSource.at(dlnSourceAddress);
  return dln.createOrder({giveTokenAddress: giveToken, giveAmount: giveAmount, takeTokenAddress: takeToken, takeAmount: takeAmount, takeChainId: takeChainId, receiverDst: receiver, givePatchAuthoritySrc: ctx.msgSender(), orderAuthorityAddressDst: receiver, allowedTakerDst: "", externalCall: "", allowedCancelBeneficiarySrc: ""}, "", 0, "");
}
`;
