// Chainlink's VRFD20, in Sauce: roll a twenty-sided die for a roller, one roll each. The roll is in
// progress until VRF answers, then holds the die's value, which `vrf-d20-house.sauce.ts` reads as a
// house.
//
// Ported from: smartcontractkit/documentation, public/samples/VRF/v2-5/VRFD20.sol
//
//   rollDice(roller)     this program
//   s_results[roller]    the Pot's storage under "VRFD20.results"; 42 while the roll is in progress
//   s_rollers            not needed: the body captures the roller it rolls for
//   fulfillRandomWords   the `.then` body
//   DiceRolled, DiceLanded  the same events, from the Pot, numbered by the Pot's own count of rolls
//   house(player)        vrf-d20-house.sauce.ts
//   s_subscriptionId, keyHash: left out. The Pot pays each roll by direct funding, in the native coin.
//
//   sauce run vrf-d20.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <roller>
//
//   roller: Address  who the die is rolled for
//
// On Base:
//
//   sauce run vrf-d20.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <roller>
import { Random } from "@sauce/random";

const ROLL_IN_PROGRESS = 42;

function main(roller: Address): Uint256 {
  const results = crypto.keccak256("VRFD20.results");
  const result = crypto.keccak256(abi.encode(roller, results));
  require(evm.sload(result) == 0, "Already rolled");
  const requestId = evm.sload(results) + 1;
  evm.sstore(results, requestId);
  Random.vrf({ words: 1, confirmations: 3 }).then((randomWords) => {
    const d20Value = (randomWords[0] % 20) + 1;
    evm.sstore(result, d20Value);
    log(hex``, crypto.keccak256("DiceLanded(uint256,uint256)"), requestId, d20Value);
  });
  evm.sstore(result, ROLL_IN_PROGRESS);
  log(hex``, crypto.keccak256("DiceRolled(uint256,address)"), requestId, roller);
  return requestId;
}
