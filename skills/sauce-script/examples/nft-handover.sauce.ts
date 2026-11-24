// Hands an NFT the Pot holds to `to`: checks that the Pot owns token `tokenId` of the ERC-721
// collection `nft`, transfers it with `safeTransferFrom`, which a contract recipient that does not
// take ERC-721 tokens refuses, and checks that `to` owns it after. No registry records an NFT
// collection, so the program calls it through its own ABI beside it, IERC721.json: the two
// functions it calls, as the ERC-721 interface declares them. Returns the token's owner after.
//
//   sauce run nft-handover.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <nft> <tokenId> <to>
//
//   nft: Address      the ERC-721 collection's contract
//   tokenId: Uint256  the token to hand over, one the Pot owns
//   to: Address       who receives it: a wallet, or a contract that takes ERC-721 tokens
//
// On Base, token 1 of a collection handed to a wallet:
//
//   sauce run nft-handover.sauce.ts --chain base --keystore <keystore> \
//     --args <nft> 1 <to>
import IERC721 from "./IERC721.json";

function main(nft: Address, tokenId: Uint256, to: Address): Address {
  require(to != 0 && to != pot, "to is another account");
  require(IERC721.at(nft).ownerOf(tokenId) == pot, "the Pot does not own that token");
  IERC721.at(nft).safeTransferFrom(pot, to, tokenId);
  const owner = IERC721.at(nft).ownerOf(tokenId);
  require(owner == to, "the token did not reach to");
  return owner;
}
