/**
 * SP1VerifierGateway calls as SauceScript templates.
 *
 * A program usually calls the gateway by its namespace instead:
 * `Succinct.VerifierGatewayGroth16.verifyProof(vkey, publicValues, proof)` reverts unless the proof
 * shows the program the verification key names committed exactly `publicValues`, and returns
 * nothing; the program then decodes the public values and acts on them, in the same transaction.
 */

// Verify an SP1 proof through `gateway`, and answer the public values' hash: reverts for a proof that
// does not verify, a route the gateway lacks (`RouteNotFound`) or has frozen (`RouteIsFrozen`).
export const verifyProof = `
import { SP1VerifierGatewayABI as ISP1VerifierGateway } from "./abis";

function main(gateway: Address, programVKey: Uint256, publicValues: bytes, proof: bytes): Uint256 {
  ISP1VerifierGateway.at(gateway).verifyProof(programVKey, publicValues, proof);
  return crypto.keccak256(publicValues);
}
`;

// The verifier a proof's first four bytes route to, and whether the route is frozen: a frozen route
// refuses every proof, as one the gateway lacks does.
export const route = `
import { SP1VerifierGatewayABI as ISP1VerifierGateway } from "./abis";

function main(gateway: Address, proof: bytes): Uint256 {
  const [verifier, frozen] = ISP1VerifierGateway.at(gateway).routes(proof.slice(0, 4).toBe() << 224);
  return frozen ? 0 : verifier;
}
`;
