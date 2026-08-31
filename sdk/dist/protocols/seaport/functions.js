export const fulfillBasicOrder = `
import { SeaportABI as ISeaport } from "./abis";

function main(
  seaportAddress: Address,
  considerationToken: Address,
  considerationIdentifier: Uint256,
  considerationAmount: Uint256,
  offerer: Address,
  zone: Address,
  offerToken: Address,
  offerIdentifier: Uint256,
  offerAmount: Uint256,
  basicOrderType: Uint256,
  startTime: Uint256,
  endTime: Uint256,
  zoneHash: Uint256,
  salt: Uint256,
  offererConduitKey: Uint256,
  fulfillerConduitKey: Uint256,
  totalOriginalAdditionalRecipients: Uint256,
  signature: bytes
): Uint256 {
  const seaport = ISeaport.at(seaportAddress);
  return seaport.fulfillBasicOrder({
    considerationToken: considerationToken,
    considerationIdentifier: considerationIdentifier,
    considerationAmount: considerationAmount,
    offerer: offerer,
    zone: zone,
    offerToken: offerToken,
    offerIdentifier: offerIdentifier,
    offerAmount: offerAmount,
    basicOrderType: basicOrderType,
    startTime: startTime,
    endTime: endTime,
    zoneHash: zoneHash,
    salt: salt,
    offererConduitKey: offererConduitKey,
    fulfillerConduitKey: fulfillerConduitKey,
    totalOriginalAdditionalRecipients: totalOriginalAdditionalRecipients,
    signature: signature
  });
}
`;
//# sourceMappingURL=functions.js.map