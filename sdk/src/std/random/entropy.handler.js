// @sauce/random's handler for `_entropyCallback(uint64,address,bytes32)`: Pyth Entropy calling the
// Pot back with the number a `Random.entropy` request asked for. Compiled for the Pot's chain, where
// `PythEntropy.Entropy` is that chain's Entropy contract, the one caller it answers.
import { entropyCallback } from "@sauce/random";

function main(caller: Address, value: Uint256, data: bytes): void {
  entropyCallback(PythEntropy.Entropy, caller, data);
}
