import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Boundless",
  slug: "boundless",
  description:
    "RISC Zero's proof market: a requestor offers ETH for a proof that a guest program (its image id) ran on an input, provers bid by locking the request with collateral, and BoundlessMarket verifies the proof, pays the prover and calls the requestor's callback with the guest's journal.",
  website: "https://boundless.network",
  github: "https://github.com/boundless-xyz/boundless",
  category: "infrastructure",
  chains: deployments,
  audited: true,
};
