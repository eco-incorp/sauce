import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Succinct SP1",
  slug: "succinct",
  description:
    "Succinct's SP1 zkVM verifiers: the SP1VerifierGateway checks, in the same call, a Groth16 or PLONK proof that an SP1 program (its verification key) ran and committed its public values, routing the proof to the verifier of the SP1 version its first four bytes name.",
  website: "https://succinct.xyz",
  github: "https://github.com/succinctlabs/sp1-contracts",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
