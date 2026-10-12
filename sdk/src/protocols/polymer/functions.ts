export const validateEvent = `
import { CrossL2ProverV2ABI as ICrossL2ProverV2 } from "./abis";

function main(proverAddress: Address, proof: bytes): bytes {
  const [chainId, emitter, topics, data] = ICrossL2ProverV2.at(proverAddress).validateEvent(proof);
  require(emitter == ctx.self(), "not this contract's log");
  return data;
}
`;
