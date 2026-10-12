// Pyth's CoinFlip, in Sauce: a fair coin flipped with Pyth Entropy, its result logged when the number
// arrives.
//
// Ported from: pyth-network/pyth-examples, entropy/coin_flip/contract/src/CoinFlip.sol
//
//   requestFlip        this program: the Pot pays Entropy's fee, read as the request is made
//   FlipRequest, FlipResult  the same events, from the Pot, numbered by the Pot's own count of flips,
//                      which the program returns
//   entropyCallback    the `.then` body
//   requestFlipWithCustomGasLimit, ...WithCustomProviderAndGasLimit: `Random.entropy({ gas })` and
//   `Random.entropy({ provider, gas })`
//   requestFlipWithCustomProviderAndGasLimitAndUserContribution: left out (no user contribution)
//   getFlipFee, getDefaultProviderGasLimit, receive: left out. The program reads the fee itself, and
//   the Pot holds the native coin that pays it.
//
//   sauce run entropy-coin-flip.sauce.ts --chain <chain> --wallet <name> --password-env <NAME>
//
// On Base, where Entropy is:
//
//   sauce run entropy-coin-flip.sauce.ts --chain base --wallet <name> --password-env <NAME>
import { Random } from "@sauce/random";

function main(): Uint256 {
  const flips = crypto.keccak256("CoinFlip.flips");
  const sequenceNumber = evm.sload(flips) + 1;
  evm.sstore(flips, sequenceNumber);
  Random.entropy().then((randomNumber) => {
    const isHeads = randomNumber % 2 == 0;
    log(abi.encode(sequenceNumber, isHeads), crypto.keccak256("FlipResult(uint64,bool)"));
  });
  log(abi.encode(sequenceNumber), crypto.keccak256("FlipRequest(uint64)"));
  return sequenceNumber;
}
