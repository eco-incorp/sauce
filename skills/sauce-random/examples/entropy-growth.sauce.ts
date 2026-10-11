// Pyth's NFTGrowth, in Sauce: grow a token with a Pyth Entropy number, 40% a level up, 40% nothing,
// 20% death, up to level 5. A token is locked while its number is on the way; if none comes within
// ten minutes, anyone may expire the request and the token unlocks.
//
// Ported from: pyth-network/pyth-examples, entropy/growing/contract/contracts/NFTGrowth.sol
//
//   grow(tokenId)      this program
//   nftInfo, nftLock   the Pot's storage under "NFTGrowth.nftInfo": level, dead, locked
//   entropyCallback    the `.then` body
//   unlock after ten minutes  the request's deadline (`.within(600)`) and the `.catch` it runs
//   NftGrowthRequested, NFTResult  the same events, from the Pot, by token
//   mint, ownership:   left out: the ERC-721 is the original's. A token starts at level 1 here.
//
//   sauce run entropy-growth.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <tokenId>
//
//   tokenId: Uint256  the token to grow
//
// On Base, where Entropy is, token 7:
//
//   sauce run entropy-growth.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args 7
import { Random } from "@sauce/random";

const MAX_LEVEL = 5;
const SUCCESS_CHANCE = 4000;
const FAIL_CHANCE = 4000;

function main(tokenId: Uint256): Uint256 {
  const nfts = crypto.keccak256("NFTGrowth.nftInfo");
  // nftInfo[tokenId]: level, dead, then locked.
  const info = crypto.keccak256(abi.encode(tokenId, nfts));
  const level = evm.sload(info) == 0 ? 1 : evm.sload(info);
  require(evm.sload(info + 2) == 0, "NFT is locked");
  require(evm.sload(info + 1) == 0, "NFT is dead");
  require(level < MAX_LEVEL, "Already max level");
  evm.sstore(info, level);
  evm.sstore(info + 2, 1);
  Random.entropy()
    .within(600)
    .then((randomNumber) => {
      const randomValue = randomNumber % 10000;
      // SUCCESS 0, FAILURE 1, DEATH 2
      let result = 1;
      if (randomValue < SUCCESS_CHANCE) {
        evm.sstore(info, evm.sload(info) + 1);
        result = 0;
      } else if (randomValue >= SUCCESS_CHANCE + FAIL_CHANCE) {
        evm.sstore(info + 1, 1);
        result = 2;
      }
      evm.sstore(info + 2, 0);
      const event = crypto.keccak256("NFTResult(uint256,uint256,bool,uint8)");
      log(abi.encode(evm.sload(info), evm.sload(info + 1) == 1, result), event, tokenId);
    })
    .catch((e) => {
      evm.sstore(info + 2, 0);
    });
  log(hex``, crypto.keccak256("NftGrowthRequested(uint256)"), tokenId);
  return level;
}
