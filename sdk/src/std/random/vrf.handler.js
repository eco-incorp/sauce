// @sauce/random's handler for `rawFulfillRandomWords(uint256,uint256[])`: Chainlink VRF's wrapper
// calling the Pot back with the words a `Random.vrf` request asked for. Compiled for the Pot's
// chain, where `ChainlinkVrf.Wrapper` is that chain's wrapper, the one caller it answers.
import { rawFulfillRandomWords } from "@sauce/random";

function main(caller: Address, value: Uint256, data: bytes): void {
  rawFulfillRandomWords(ChainlinkVrf.Wrapper, caller, data);
}
