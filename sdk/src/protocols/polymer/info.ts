import type { ProtocolInfo } from "../../core/types.js";
import { deployments } from "./addresses.js";

export const protocolInfo: ProtocolInfo = {
  name: "Polymer",
  slug: "polymer",
  description:
    "Cross-chain event proofs: a log emitted on one chain is proven on another by its prover contract, CrossL2ProverV2, from a proof anyone fetches from Polymer's prove API and submits. Pull-based: no message is sent and no fee is paid on the source.",
  website: "https://polymerlabs.org",
  github: "https://github.com/polymerdao/prover-contracts",
  category: "cross-chain",
  chains: deployments,
  audited: false,
};
